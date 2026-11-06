CREATE TABLE public.chico_reporting_sessions (
 id_sessao text PRIMARY KEY, user_id uuid, dt_inicio timestamptz NOT NULL, dt_fim timestamptz,
 ultima_mensagem timestamptz NOT NULL, qtd_mensagens integer NOT NULL DEFAULT 0, intencao text,
 resolvida boolean NOT NULL DEFAULT false, escalonada boolean NOT NULL DEFAULT false, elegivel boolean NOT NULL DEFAULT false,
 nota integer, ids_chamados_glpi jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.chico_reporting_sessions TO service_role;
ALTER TABLE public.chico_reporting_sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.chico_reporting_attempts (
 id_tentativa uuid PRIMARY KEY, id_sessao text NOT NULL, dt_tentativa timestamptz NOT NULL,
 sucesso boolean NOT NULL, id_chamado_glpi text, codigo_erro text, mensagem_erro text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.chico_reporting_attempts TO service_role;
ALTER TABLE public.chico_reporting_attempts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.chico_webhook_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE, evento text NOT NULL,
 payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 locked_until timestamptz, delivered_at timestamptz, last_error text, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.chico_webhook_outbox TO service_role;
ALTER TABLE public.chico_webhook_outbox ENABLE ROW LEVEL SECURITY;
CREATE INDEX chico_outbox_pending ON public.chico_webhook_outbox(available_at) WHERE delivered_at IS NULL;
CREATE INDEX chico_sessions_updated ON public.chico_reporting_sessions(updated_at,id_sessao);
CREATE INDEX chico_attempts_updated ON public.chico_reporting_attempts(updated_at,id_tentativa);
CREATE OR REPLACE FUNCTION public.chico_queue_event(k text, e text, p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.chico_webhook_outbox(event_key,evento,payload) VALUES(k,e,p)
 ON CONFLICT(event_key) DO UPDATE SET evento=excluded.evento,payload=excluded.payload,attempts=0,available_at=now(),delivered_at=NULL,updated_at=now();
END $$;
CREATE OR REPLACE FUNCTION public.chico_queue_session(sid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.chico_reporting_sessions;
BEGIN
 SELECT * INTO s FROM public.chico_reporting_sessions WHERE id_sessao=sid;
 IF s.dt_fim IS NOT NULL THEN
 PERFORM public.chico_queue_event('session:'||sid,'sessao.encerrada',jsonb_build_object('id_sessao',sid,'_user_id',s.user_id,'dt_inicio',s.dt_inicio,'dt_fim',s.dt_fim,'qtd_mensagens',s.qtd_mensagens,'duracao_seg',greatest(0,extract(epoch from s.dt_fim-s.dt_inicio)::integer),'intencao',s.intencao,'resolvida',s.resolvida,'escalonada',s.escalonada,'elegivel',s.elegivel,'nota',s.nota,'qtd_chamados',jsonb_array_length(s.ids_chamados_glpi),'ids_chamados_glpi',s.ids_chamados_glpi,'dt_carga',s.updated_at));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.chico_capture_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.conversas; sid text; meaningful boolean;
BEGIN
 SELECT * INTO c FROM public.conversas WHERE id=NEW.conversa_id;
 sid:=coalesce(c.session_id::text,c.id::text);
 meaningful:=NEW.role='user' AND length(trim(NEW.conteudo))>12
 AND NEW.conteudo !~* '^(olá|ola|oi|bom dia|boa tarde|boa noite)[!,.?[:space:]]*$'
 AND NEW.conteudo !~* '^Olá! (Tenho uma demanda de TI|Estou com um problema|Preciso de ajuda)'
 AND NEW.conteudo !~* '^teste([!,.?[:space:]]|$)';
 INSERT INTO public.chico_reporting_sessions(id_sessao,user_id,dt_inicio,ultima_mensagem,qtd_mensagens,elegivel)
 VALUES(sid,c.user_id,NEW.created_at,NEW.created_at,1,meaningful)
 ON CONFLICT(id_sessao) DO UPDATE SET ultima_mensagem=greatest(chico_reporting_sessions.ultima_mensagem,NEW.created_at),qtd_mensagens=chico_reporting_sessions.qtd_mensagens+1,elegivel=chico_reporting_sessions.elegivel OR meaningful,dt_fim=NULL,updated_at=now();
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'chico reporting message capture failed'; RETURN NEW;
END $$;
CREATE TRIGGER chico_reporting_message AFTER INSERT ON public.mensagens FOR EACH ROW EXECUTE FUNCTION public.chico_capture_message();
CREATE OR REPLACE FUNCTION public.chico_capture_analytics() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sid text;
BEGIN
 SELECT coalesce(session_id::text,id::text) INTO sid FROM public.conversas WHERE id=NEW.conversa_id;
 IF sid IS NULL THEN RETURN NEW; END IF;
 UPDATE public.chico_reporting_sessions SET
 intencao=CASE WHEN NEW.event_type='category_detected' THEN NEW.category ELSE intencao END,
 resolvida=CASE WHEN NEW.event_type='resolved_without_ticket' THEN true ELSE resolvida END,
 nota=CASE WHEN NEW.event_type='rating_received' THEN (NEW.metadata->>'rating')::integer ELSE nota END,
 dt_fim=CASE WHEN NEW.event_type='conversation_finished' AND NEW.metadata->>'reason'='new_conversation' THEN ultima_mensagem ELSE dt_fim END,
 updated_at=now() WHERE id_sessao=sid;
 PERFORM public.chico_queue_session(sid);
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'chico reporting event capture failed'; RETURN NEW;
END $$;
CREATE TRIGGER chico_reporting_analytics AFTER INSERT ON public.analytics_events FOR EACH ROW EXECUTE FUNCTION public.chico_capture_analytics();
CREATE OR REPLACE FUNCTION public.chico_capture_ticket() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sid text; e text; code text;
BEGIN
 IF NEW.categoria='Teste' OR NEW.titulo='Chamado de teste' THEN RETURN NEW; END IF;
 SELECT coalesce(session_id::text,id::text) INTO sid FROM public.conversas WHERE id=NEW.conversa_id;
 sid:=coalesce(sid,'ticket:'||NEW.id::text);
 e:=CASE WHEN NEW.status='success' THEN 'chamado.aberto' ELSE 'chamado.falha' END;
 code:=CASE WHEN NEW.status='success' THEN NULL WHEN NEW.error_message ~* 'tempo limite|timeout|não respondeu' THEN 'GLPI_TIMEOUT' ELSE 'GLPI_ERROR' END;
 INSERT INTO public.chico_reporting_attempts(id_tentativa,id_sessao,dt_tentativa,sucesso,id_chamado_glpi,codigo_erro,mensagem_erro)
 VALUES(NEW.id,sid,NEW.created_at,NEW.status='success',NEW.glpi_ticket_id,code,CASE WHEN code='GLPI_TIMEOUT' THEN 'Tempo limite ao acessar o GLPI.' WHEN code IS NOT NULL THEN 'Falha ao abrir chamado no GLPI.' ELSE NULL END);
 UPDATE public.chico_reporting_sessions SET escalonada=true,intencao=coalesce(NEW.categoria,intencao),
 ids_chamados_glpi=CASE WHEN NEW.glpi_ticket_id IS NOT NULL AND NOT ids_chamados_glpi @> jsonb_build_array(NEW.glpi_ticket_id) THEN ids_chamados_glpi||jsonb_build_array(NEW.glpi_ticket_id) ELSE ids_chamados_glpi END,updated_at=now() WHERE id_sessao=sid;
 PERFORM public.chico_queue_event('attempt:'||NEW.id::text,e,(SELECT to_jsonb(a)-'updated_at' FROM public.chico_reporting_attempts a WHERE id_tentativa=NEW.id));
 PERFORM public.chico_queue_session(sid);
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'chico reporting ticket capture failed'; RETURN NEW;
END $$;
CREATE TRIGGER chico_reporting_ticket AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.chico_capture_ticket();
CREATE OR REPLACE FUNCTION public.chico_close_idle_sessions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sid text;
BEGIN
 FOR sid IN UPDATE public.chico_reporting_sessions SET dt_fim=ultima_mensagem,updated_at=now() WHERE dt_fim IS NULL AND ultima_mensagem<now()-interval '30 minutes' RETURNING id_sessao LOOP
 PERFORM public.chico_queue_session(sid);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.chico_claim_webhooks() RETURNS SETOF public.chico_webhook_outbox LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.chico_webhook_outbox SET locked_until=now()+interval '2 minutes'
 WHERE id IN (SELECT id FROM public.chico_webhook_outbox WHERE delivered_at IS NULL AND attempts<4 AND available_at<=now() AND (locked_until IS NULL OR locked_until<now()) ORDER BY available_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.chico_queue_event(text,text,jsonb),public.chico_queue_session(text),public.chico_capture_message(),public.chico_capture_analytics(),public.chico_capture_ticket(),public.chico_close_idle_sessions(),public.chico_claim_webhooks() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chico_queue_event(text,text,jsonb),public.chico_queue_session(text),public.chico_close_idle_sessions(),public.chico_claim_webhooks() TO service_role;