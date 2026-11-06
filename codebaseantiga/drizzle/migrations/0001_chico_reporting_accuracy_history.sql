ALTER TABLE public.chico_reporting_sessions ADD COLUMN IF NOT EXISTS historica boolean NOT NULL DEFAULT false;
ALTER TABLE public.chico_reporting_sessions ADD COLUMN IF NOT EXISTS teste_interno boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.chico_real_it_message(t text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT length(trim(t))>2 AND t !~* '^(/teste|teste)([!,.?[:space:]]|$)' AND t !~* '^Olá! .*Pode (me |estar |ser |estar lento)' AND t !~* '^Olá! (Estou com|Tenho uma|Preciso de)' AND t ~* '(computador|mouse|teclado|monitor|impress|internet|rede|wi.?fi|email|e-mail|senha|sistema|\msei\M|acesso|arquivo|software|hardware|notebook|scanner|vpn|equipamento|travando|offline|conexão|servidor|periférico|\mti\M|\mtic\M)';
$$;
CREATE OR REPLACE FUNCTION public.chico_capture_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.conversas; sid text; meaningful boolean; internal_test boolean;
BEGIN
 SELECT * INTO c FROM public.conversas WHERE id=NEW.conversa_id;
 sid:=coalesce(c.session_id::text,c.id::text);
 meaningful:=NEW.role='user' AND public.chico_real_it_message(NEW.conteudo);
 internal_test:=NEW.role='user' AND trim(NEW.conteudo) ~* '^(/teste|teste)([!,.?[:space:]]|$)';
 INSERT INTO public.chico_reporting_sessions(id_sessao,user_id,dt_inicio,ultima_mensagem,qtd_mensagens,elegivel,teste_interno)
 VALUES(sid,c.user_id,NEW.created_at,NEW.created_at,1,meaningful AND NOT internal_test,internal_test)
 ON CONFLICT(id_sessao) DO UPDATE SET ultima_mensagem=greatest(chico_reporting_sessions.ultima_mensagem,NEW.created_at),qtd_mensagens=chico_reporting_sessions.qtd_mensagens+1,
 teste_interno=chico_reporting_sessions.teste_interno OR internal_test,
 elegivel=(chico_reporting_sessions.elegivel OR meaningful) AND NOT (chico_reporting_sessions.teste_interno OR internal_test),dt_fim=NULL,updated_at=now();
 IF NEW.role='user' THEN
 UPDATE public.chico_reporting_sessions SET resolvida=CASE
 WHEN NEW.conteudo ~* '(nao resolveu|não resolveu|nao funcionou|não funcionou|continua|persiste|ainda com problema|ainda com erro|segue com problema)' THEN false
 WHEN NEW.conteudo ~* '(resolveu|resolvido|funcionou|deu certo|solucionado|ok agora|agora foi|já está funcionando)' THEN true ELSE resolvida END WHERE id_sessao=sid;
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'chico reporting message capture failed'; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.chico_capture_analytics() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sid text;
BEGIN
 SELECT coalesce(session_id::text,id::text) INTO sid FROM public.conversas WHERE id=NEW.conversa_id;
 IF sid IS NULL THEN RETURN NEW; END IF;
 UPDATE public.chico_reporting_sessions SET
 intencao=CASE WHEN NEW.event_type='category_detected' THEN NEW.category ELSE intencao END,
 nota=CASE WHEN NEW.event_type='rating_received' THEN (NEW.metadata->>'rating')::integer ELSE nota END,
 teste_interno=teste_interno OR coalesce((NEW.metadata->>'test_mode')::boolean,false),
 elegivel=elegivel AND NOT coalesce((NEW.metadata->>'test_mode')::boolean,false),
 dt_fim=CASE WHEN NEW.event_type='conversation_finished' AND NEW.metadata->>'reason'='new_conversation' THEN NEW.created_at ELSE dt_fim END,
 updated_at=now() WHERE id_sessao=sid;
 PERFORM public.chico_queue_session(sid);
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'chico reporting event capture failed'; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.chico_real_it_message(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chico_real_it_message(text) TO service_role;
INSERT INTO public.chico_reporting_sessions(id_sessao,user_id,dt_inicio,dt_fim,ultima_mensagem,qtd_mensagens,historica,updated_at)
 SELECT coalesce(c.session_id::text,c.id::text),c.user_id,min(m.created_at),max(m.created_at),max(m.created_at),count(*)::integer,true,max(m.created_at)
 FROM public.conversas c JOIN public.mensagens m ON m.conversa_id=c.id GROUP BY coalesce(c.session_id::text,c.id::text),c.user_id
 ON CONFLICT(id_sessao) DO NOTHING;
INSERT INTO public.chico_reporting_attempts(id_tentativa,id_sessao,dt_tentativa,sucesso,id_chamado_glpi,codigo_erro,mensagem_erro,updated_at)
 SELECT t.id,coalesce(c.session_id::text,c.id::text,'ticket:'||t.id::text),t.created_at,t.status='success',t.glpi_ticket_id,
 CASE WHEN t.status='success' THEN NULL ELSE 'GLPI_ERROR' END,
 CASE WHEN t.status='success' THEN NULL ELSE 'Falha ao abrir chamado no GLPI.' END,t.created_at
 FROM public.tickets t LEFT JOIN public.conversas c ON c.id=t.conversa_id WHERE coalesce(t.categoria,'')<>'Teste' AND coalesce(t.titulo,'')<>'Chamado de teste'
 ON CONFLICT(id_tentativa) DO NOTHING;