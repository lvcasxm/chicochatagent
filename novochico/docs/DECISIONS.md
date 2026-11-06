# Registro de decisões arquiteturais — ChicoChat+

**Situação geral: PROPOSTA, aguardando aprovação do responsável pelo projeto.**

Como usar:
- Decisões novas entram no fim, com o próximo número.
- Nunca reescreva uma decisão aprovada. Para mudá-la, crie uma nova com "Substitui ADR-XXX" e marque a antiga como "Substituída por ADR-YYY".
- O Sonnet registra aqui decisões pequenas que afetem outros módulos e sinaliza ambiguidades relevantes em vez de decidir sozinho.

---

## ADR-001 — TypeScript em todo o sistema, sobre Node.js LTS

- **Contexto:** o legado já é TypeScript, e a equipe o conhece.
- **Problema:** escolher a linguagem de frontend e backend.
- **Decisão:** TypeScript estrito em frontend, backend e contratos; Node.js na versão LTS ativa, fixada em `.nvmrc` e `engines`.
- **Justificativa:** reaproveita conhecimento, permite compartilhar esquemas de validação e mantém um único ecossistema para uma equipe pequena.
- **Alternativas:** Python/FastAPI (dois ecossistemas e sem ganho concreto aqui); Deno (menor oferta de bibliotecas e de quem o administre).
- **Consequências:** atualizações de Node e dependências passam a ser responsabilidade da equipe.

## ADR-002 — Monorepo simples com npm workspaces

- **Contexto:** há frontend, API e contratos compartilhados.
- **Problema:** organizar sem criar complexidade de build.
- **Decisão:** `apps/web`, `apps/api` e `packages/shared` com npm workspaces, sem Turborepo ou Nx.
- **Justificativa:** o npm já vem com o Node e basta para três pacotes.
- **Alternativas:** pnpm (bom, mas exige instalar mais uma ferramenta); repositórios separados (contratos divergem); pasta única (mistura dependências de servidor e navegador).
- **Consequências:** `packages/shared` não pode depender de nada específico de navegador ou de Node.

## ADR-003 — Backend como monólito modular em Fastify

- **Contexto:** o legado é um conjunto de funções sem camada de domínio. O sistema tem poucos usuários simultâneos, e seu trabalho se concentra em chamadas externas.
- **Problema:** criar limites claros sem excesso de cerimônia.
- **Decisão:** um único processo Fastify com módulos de domínio, em que cada módulo tem rotas finas, serviço e repositório.
- **Justificativa:** logs estruturados nativos, sistema de plugins simples, bom suporte a streaming e pouca "mágica". Um desenvolvedor novo entende o fluxo seguindo imports.
- **Alternativas:** Next.js (route handlers misturam UI e servidor, e o SSR não traz benefício em app autenticado); NestJS (cerimônia desproporcional); Hono (bom, porém com menos plugins prontos para sessão, rate limit e helmet); microserviços (sem necessidade).
- **Consequências:** escala vertical e uma instância, o que simplifica semáforo, breaker e rate limit em memória. Para escalar horizontalmente, será preciso revisá-los.

## ADR-004 — PostgreSQL convencional em vez de Supabase próprio

- **Contexto:** o legado usa do Supabase, essencialmente, banco, auth e RLS. Hospedá-lo significa operar cerca de dez serviços ao redor do Postgres (gateway, PostgREST, GoTrue, Realtime, Storage, Studio, pooler etc.).
- **Problema:** escolher a persistência para o servidor da Prefeitura, que pode querer administrar o banco diretamente.
- **Decisão:** PostgreSQL oficial, acessado somente pela API, com um usuário de aplicação sem privilégios de superusuário.
- **Justificativa:** um serviço só, ferramentas padrão de backup e administração, nenhuma exposição direta do banco ao navegador. Autorização fica em código testável.
- **Alternativas:** Supabase self-hosted (superfície operacional muito maior para recursos dos quais o novo desenho não precisa); SQLite (fraco para concorrência e administração institucional); MySQL (sem vantagem e exige reescrever o SQL conhecido).
- **Consequências:** RLS deixa de ser a barreira principal. Toda consulta passa por repositórios que recebem o usuário autenticado, e isso é coberto por testes de autorização.

## ADR-005 — Drizzle ORM com migrations versionadas e só para frente

- **Contexto:** o legado tem duas trilhas de migration e dados sem origem versionada.
- **Problema:** evoluir o schema com segurança.
- **Decisão:** Drizzle para schema e consultas tipadas; `drizzle-kit generate` para gerar SQL revisável; aplicar com comando explícito, nunca automaticamente em produção. Sem `DROP` ou alteração destrutiva sem aprovação.
- **Justificativa:** próximo de SQL, sem engine binária, tipagem forte.
- **Alternativas:** Prisma (engine e abstração maiores); Kysely (bom, mas sem gestão integrada de migrations); SQL puro (perde tipagem).
- **Consequências:** seed idempotente separado de migrations; dados reais nunca entram em migrations.

## ADR-006 — SPA React + Vite servida pela própria API

- **Contexto:** app inteiramente autenticado; não precisa de SEO nem SSR.
- **Problema:** como construir e entregar o frontend.
- **Decisão:** React + Vite + React Router + TanStack Query. Em produção, o Fastify entrega os arquivos estáticos, formando um único contêiner de aplicação na mesma origem.
- **Justificativa:** mesma origem elimina CORS e facilita cookies; implantação com um só artefato.
- **Alternativas:** Next.js (ver ADR-003); nginx separado (mais um serviço, útil só com volume que não se espera); hospedagem em CDN (dependência externa).
- **Consequências:** o proxy reverso/TLS da Prefeitura fica à frente (`PEND-08`). Em desenvolvimento, o Vite encaminha `/api` para a API.

## ADR-007 — Componentes próprios com Tailwind e Radix seletivo

- **Contexto:** o legado usa shadcn/ui em bloco; o requisito é não parecer template.
- **Problema:** obter acessibilidade sem herdar uma estética pronta.
- **Decisão:** Tailwind CSS com tokens da marca, componentes próprios e primitivas Radix **só** para o que é difícil acertar: diálogo, select, tooltip, menu. `lucide-react` para ícones; `recharts` só no admin.
- **Justificativa:** acessibilidade das primitivas com identidade visual própria e poucas dependências.
- **Alternativas:** shadcn/ui completo (visual padronizado, muito código sem uso); Material UI ou Mantine (identidade forte de terceiros); CSS sem primitivas (risco de acessibilidade).
- **Consequências:** o Sonnet cria primeiro o conjunto mínimo de componentes (F3); telas não usam estilos avulsos.

## ADR-008 — Sessão no servidor via cookie; Better Auth, sujeito a validação

> **Substituída por ADR-027.**

- **Contexto:** o legado guarda JWT em `localStorage` (S-06) e valida domínio só no cliente (S-07).
- **Problema:** autenticar sem Supabase nem Lovable, com baixo risco e pouca manutenção.
- **Decisão:** sessões persistidas em PostgreSQL, em cookie `HttpOnly`, `Secure` e `SameSite=Lax`. Provedores: Google OIDC com verificação do claim `hd` e de `email_verified` no servidor; e-mail e senha conforme `PEND-01`. Usar **Better Auth** com adaptador Drizzle.
- **Justificativa:** evita escrever à mão redefinição de senha, tokens de verificação e limites de login. A documentação da biblioteca afirma validar o `hd` no token assinado `[DOC]`.
- **Condição:** a primeira tarefa da F2 é validar, em versão estável, a integração com Fastify e Drizzle. Se falhar, usar `openid-client` + `argon2` + tabela própria de sessões, e registrar nova ADR.
- **Alternativas:** Supabase Auth isolado (mais um serviço); Keycloak (robusto, operação pesada, considerar se a Prefeitura adotar SSO corporativo); autenticação escrita do zero (mais risco); LDAP/AD (`PEND-01`).
- **Consequências:** domínios permitidos em configuração e validados no servidor, em todos os fluxos, inclusive cadastro.

## ADR-009 — Papéis no banco, sem identidades fixas no código

- **Contexto:** há e-mails fixos no código e UUIDs em migrations (RN-02, RN-04, S-18).
- **Problema:** autorizar sem expor identidades nem manter duas listas.
- **Decisão:** coluna `users.role` com `user`, `tecnico` ou `admin`. Primeiro admin criado por comando de CLI (`npm run admin:grant -- <email>`). Bypass de triagem e chamado de teste ficam restritos a `admin`.
- **Justificativa:** fonte única, auditável, sem dados pessoais em código.
- **Alternativas:** tabela de papéis N:N (flexibilidade sem uso); variável de ambiente com e-mails (difícil de auditar).
- **Consequências:** `tecnico` existe para ler transcrições (ADR-016); depende de `PEND-10`.

## ADR-010 — O servidor é dono da conversa

- **Contexto:** o cliente monta o histórico enviado à IA, grava mensagens e pode forjar papéis (S-05, S-09).
- **Problema:** garantir integridade do que a IA recebe e do que vai para o chamado.
- **Decisão:** o cliente envia só o texto. O servidor valida posse da conversa, grava a mensagem, carrega o histórico do banco, chama a IA, grava a resposta. O estado de triagem também fica no banco.
- **Justificativa:** elimina forja de histórico; recarregar a página não perde estado; transcrição e métricas passam a ser confiáveis.
- **Alternativas:** manter o cliente enviando o histórico com validação (não há como validar o que o modelo "disse").
- **Consequências:** uma resposta interrompida precisa de política definida: guarda-se o texto parcial, marcado como incompleto.

## ADR-011 — Gemini direto, atrás de uma interface própria, com marcadores tratados no servidor

- **Contexto:** o legado usa o endpoint compatível com OpenAI e marcadores em texto, com bons resultados; o fallback e a Análise IA dependem do Lovable.
- **Problema:** remover o Lovable sem regredir a triagem e sem que o cliente interprete sinais da IA.
- **Decisão:**
  1. SDK oficial `@google/genai` atrás da interface `LlmClient`, com modelo definido por ambiente.
  2. **Manter** os marcadores `<<OPEN_TICKET_FORM>>` e `<<RESOLUTION_ATTEMPT>>` no prompt. O servidor os filtra do stream e emite eventos tipados. O cliente nunca os vê.
  3. Resumo e Análise IA usam saída estruturada em JSON com esquema, validada por zod.
- **Justificativa:** o prompt e os marcadores são comprovados com esse modelo. Mudar SDK e protocolo de sinalização de uma só vez dificultaria diagnosticar regressões.
- **Alternativas:** function calling para sinalizar (mais limpo, porém não testado em streaming com este prompt; reavaliar após a suíte de cenários existir); manter o endpoint compatível (funciona, mas com menos recursos de saída estruturada); LiteLLM ou gateway (serviço a mais).
- **Consequências:** o filtro de stream retém sequências parciais iniciadas por `<`. A compatibilidade dos parâmetros precisa ser confirmada na F4 com chave de desenvolvimento.

## ADR-012 — Abertura de chamado condicionada no backend

- **Contexto:** hoje o formulário abre por decisão do cliente, e a API aceita qualquer chamada (S-02).
- **Problema:** a triagem precisa valer de fato, sem bloquear quem precisa do GLPI.
- **Decisão:** quando a IA escala, o servidor grava `conversations.ticket_form_unlocked_at`. `POST /tickets` exige esse campo, salvo para admin. O atalho "usuário avançado" continua levando ao portal GLPI.
- **Justificativa:** cumpre RN-08 a RN-10 com regra no servidor; não há perda, pois o portal segue disponível.
- **Alternativas:** não condicionar (permite pular a triagem pela API); exigir contagem mínima de tentativas (regra nova não presente no legado).
- **Consequências:** a IA continua decidindo quando escalar; o backend garante apenas que a decisão ocorreu. Se a IA falhar, o usuário usa o portal.

## ADR-013 — Identidade do chamado vem da sessão

- **Contexto:** nome e e-mail são digitados e aceitos sem validação (S-02, B-10).
- **Problema:** garantir que o solicitante é quem está logado.
- **Decisão:** nome e e-mail do solicitante vêm da sessão e aparecem somente como leitura. O formulário pede setor, IP e, se for o caso, dados do atendido. A resposta da IA nunca define identidade, papel ou solicitante.
- **Justificativa:** requisito explícito de não confiar no modelo nem no cliente para identidade.
- **Alternativas:** e-mail editável (mantém o problema).
- **Consequências:** nome incorreto no cadastro precisa de correção no perfil. Terceiros continuam atendidos pelo campo "em nome de outra pessoa".

## ADR-014 — Sistema de um único tenant

- **Contexto:** organizações e slugs servem a um produto multi-cliente que não existe aqui `[INFERIDO]`.
- **Problema:** evitar complexidade sem uso.
- **Decisão:** remover organizações, slugs e "Gerar Agente". O conteúdo passa a ser global. `/agent/:slug` redireciona para `/` por compatibilidade com links antigos.
- **Justificativa:** menos filtros, menos risco de vazamento entre tenants, modelo mais claro.
- **Alternativas:** manter multi-tenant (custo permanente sem benefício).
- **Consequências:** se outra instituição usar o sistema, a resposta recomendada é outra implantação. Confirmar em `PEND-11`.

## ADR-015 — Regras no código; conteúdo editável no banco

> **Substituída por ADR-030.**

- **Contexto:** o núcleo do prompt é código, e o conteúdo editável por admins se mistura a ele.
- **Problema:** um admin não deve conseguir desativar regras de segurança pelo painel, nem a equipe depender de deploy para ajustar um fluxo.
- **Decisão:** regras invioláveis em `modules/chat/prompt/` versionadas no Git e cobertas por testes; categorias, tópicos e fluxos no banco. A versão efetiva do prompt é um hash do conjunto. O prompt monta com a mesma ordem do legado.
- **Justificativa:** auditável, testável e mantém autonomia do admin.
- **Alternativas:** prompt inteiro editável (risco); tudo em código (dependência de deploy).
- **Consequências:** a tela de prompt mostra o texto **realmente enviado**, somente leitura.

## ADR-016 — Transcrição exige autenticação

- **Contexto:** o link atual dá acesso público permanente (S-03).
- **Problema:** técnicos precisam do contexto, sem expor dados pessoais.
- **Decisão:** o link permanece no chamado, mas exige login e papel `tecnico` ou `admin`, ou ser o dono da conversa. O token é aleatório, com 256 bits, e só seu hash é armazenado. Cada acesso gera registro de auditoria. O conteúdo é um snapshot do momento da abertura.
- **Justificativa:** mantém o fluxo do técnico e fecha a exposição.
- **Alternativas:** token com expiração sem login (o link continua transferível); remover o link (perde funcionalidade valiosa).
- **Consequências:** técnicos precisam de conta com papel atribuído (`PEND-10`). Links antigos só valem se os dados forem migrados.

## ADR-017 — GLPI: só High-Level API, sem corrida de endpoints e sem reenvio cego

- **Contexto:** há tentativas paralelas de token (B-08), código morto da API legada e nenhuma idempotência (B-09).
- **Problema:** integrar de forma previsível, sem duplicar chamados.
- **Decisão:** um cliente único, com caminho do token definido em configuração, sem corrida e sem API legada. Fluxo:
  1. Grava tentativa `pending` com chave de idempotência.
  2. Gera o resumo.
  3. Cria o chamado no GLPI.
  4. Anexa o solicitante (melhor esforço).
  5. Conclui a tentativa.

  `POST` de criação **nunca** é repetido automaticamente em timeout; o usuário vê status indeterminado e orientação.
- **Justificativa:** a duplicidade é pior que uma falha visível. O novo fluxo também concentra toda a lógica de OAuth em um único lugar.
- **Alternativas:** repetir com verificação posterior (a API não oferece chave de idempotência confirmada).
- **Consequências:** a instância deve ter caminho e versão confirmados (`PEND-05`). Categoria ITIL e tipo só mudam após `PEND-05`.

## ADR-018 — Eventos e métricas calculados no servidor

- **Contexto:** o cliente grava eventos e calcula KPIs baixando tudo (S-09, limitação 4).
- **Problema:** ter métricas confiáveis e leves.
- **Decisão:** eventos emitidos pelos serviços. Admin consome agregados SQL paginados. Indicadores corrigidos: **resolvido confirmado**, **escalonado** e **sem desfecho** passam a ser separados (B-05).
- **Justificativa:** o número deixa de depender de uma aba aberta; separar "sem desfecho" evita superestimar o resultado.
- **Alternativas:** ferramenta externa de analytics (dados saem da Prefeitura).
- **Consequências:** séries históricas migradas têm definição diferente e precisam ser sinalizadas.

## ADR-019 — Google Sheets opcional, por outbox e desligado por padrão

- **Contexto:** a integração nunca foi ativada, mas existe uma política de privacidade bem pensada (RN-35).
- **Problema:** preservar o conhecimento sem construir o que pode não ser usado.
- **Decisão:** implementar só na F10, se `PEND-12` confirmar a necessidade. Se sim: outbox no Postgres, processador periódico dentro da API, campos permitidos e HMAC, `REPORTING_ENABLED=false` por padrão.
- **Justificativa:** elimina triggers com lógica de negócio e não precisa de filas externas.
- **Alternativas:** Redis/BullMQ (desnecessário), `pg_cron` (exige extensão).
- **Consequências:** falha de entrega nunca afeta o atendimento.

## ADR-020 — Resiliência e cache em processo, sem Redis

- **Contexto:** há semáforo e breaker por instância efêmera; o cache tem defeitos (B-01, B-02).
- **Problema:** proteger o orçamento e a experiência sem novos serviços.
- **Decisão:** semáforo, breaker e rate limit em memória (uma instância, ADR-003). Cache do primeiro turno em PostgreSQL, com chave `hash(versão do prompt + mensagem normalizada)` e `expires_at` renovado. Mensagens com aparência de dado pessoal não entram no cache.
- **Justificativa:** com um processo só, os controles em memória são exatos.
- **Alternativas:** Redis (sem necessidade identificada); remover o cache (perda de economia e latência nas mensagens prontas).
- **Consequências:** reinício zera os limites em memória, o que é aceitável.

## ADR-021 — Docker Compose como alvo de implantação

- **Contexto:** o servidor da Prefeitura será definido ao fim do projeto.
- **Problema:** garantir portabilidade sem resolver o deploy agora.
- **Decisão:** PostgreSQL em Compose desde a F0, para desenvolvimento. `Dockerfile` e `compose.prod.yml` de referência na F10. Sem Kubernetes.
- **Justificativa:** reprodutível e simples de operar.
- **Alternativas:** instalação direta (menos reprodutível); Kubernetes (sem necessidade).
- **Consequências:** se o servidor não aceitar contêineres, a aplicação segue rodando como processo Node (`PEND-08`).

## ADR-022 — Remoção de Realtime e Storage; conhecimento e contatos adiados

- **Contexto:** Realtime só recarrega a lista; o upload de arquivos e os contatos não afetam a IA.
- **Problema:** evitar reconstruir recursos sem efeito.
- **Decisão:** sem Realtime nem Storage. Telas de Conhecimento e Contatos ficam fora do escopo inicial até `PEND-14`. Se a equipe quiser que o conhecimento alimente a IA, isso será uma funcionalidade nova, a ser desenhada.
- **Justificativa:** o legado sugere um recurso que não existe.
- **Alternativas:** portar como está (mantém a ilusão); implementar RAG agora (escopo novo).
- **Consequências:** o conteúdo existente, se houver, é preservado na exportação.

## ADR-023 — Dados pessoais mínimos; CPF não é coletado

- **Contexto:** não há CPF no legado em uso; helpers sobraram sem chamador.
- **Problema:** evitar dado pessoal sem finalidade.
- **Decisão:** não coletar CPF. Dados de chamado (IP, setor) ficam só onde têm finalidade. Logs nunca contêm conteúdo de conversa, e-mail, nome ou IP de máquina. A IA recebe o mínimo; os dados da sessão não entram no prompt.
- **Justificativa:** minimização e redução de risco; nenhuma regra atual precisa de CPF.
- **Alternativas:** coletar para identificar servidores (e-mail institucional já identifica).
- **Consequências:** se a Prefeitura exigir CPF, será uma nova decisão, com base legal definida (`PEND-07`).

## ADR-024 — Tipografia: Velocity só no logotipo; texto em Montserrat e Inter (provisório)

- **Contexto:** a Velocity é a fonte oficial `[DOC]`. O arquivo disponível (`codebaseantiga/src/assets/fonts/velocity.ttf`) mapeia só 54 caracteres: A-Z e a-z, sem dígitos, acentos nem pontuação (verificado na tabela `cmap`). Seus metadados indicam copyright de 2007, designer Alan Brown, proprietário em branco e `fsType=4` (incorporação restrita a "Preview & Print"). O próprio PDF da marca usa Montserrat em títulos e corpo, e tem Inter incorporada.
- **Problema:** em português, a Velocity desse arquivo não consegue escrever "Conexão". A licença de uso web também não foi localizada.
- **Decisão:** **provisoriamente**, a Velocity aparece apenas no logotipo, como imagem. Títulos em Montserrat, interface e texto corrido em Inter, ambas auto-hospedadas. O arquivo `velocity.ttf` **não** entra no novo projeto até `PEND-09`.
- **Justificativa:** respeita a marca sem violar licença e sem quebrar texto. Montserrat e Inter já são as fontes de apoio do material oficial.
- **Alternativas:** usar Velocity em títulos (quebra com acentos e dígitos); similar geométrica (troca a identidade sem autorização).
- **Consequências:** esta é uma substituição registrada, **não definitiva**. Com o arquivo completo licenciado, a Velocity pode entrar em títulos curtos via token `--font-display`, sem alterar componentes.

## ADR-025 — Regras de contraste para o azul da marca

- **Contexto:** `#24BCEC` tem contraste de cerca de 2,1:1 com `#FBFBFB` e de cerca de 8,5:1 com `#111110` (calculado pela fórmula WCAG).
- **Problema:** o legado usa branco sobre azul e links azuis no claro (B-19).
- **Decisão:** texto e ícone sobre azul são `#111110`. No tema claro, azul é preenchimento, nunca texto ou único indicador: link é `#111110` sublinhado em azul, e foco é contorno `#111110`. No tema escuro, azul pode ser texto, link e foco.
- **Justificativa:** mantém o azul como destaque e cumpre AA sem criar cores novas.
- **Alternativas:** escurecer o azul (criaria uma cor fora da paleta).
- **Consequências:** o logotipo mantém suas versões oficiais; a regra vale para a interface.

## ADR-026 — Estrutura no repositório existente

- **Contexto:** a raiz Git (`C:\dev\novochico`) contém `codebaseantiga/` e `novochico/`.
- **Problema:** não sobrescrever o que existe e manter a separação.
- **Decisão:** todo o novo projeto fica em `novochico/`. O `CLAUDE.md` e as regras da raiz não são alterados. Sessões de implementação devem abrir com `novochico/` como diretório de trabalho, para carregar `novochico/CLAUDE.md` e `novochico/.claude/rules/`.
- **Justificativa:** o `CLAUDE.md` da raiz referencia `@rules/*`, caminho que não existe a partir dali; as regras estão em `novochico/.claude/rules/`.
- **Alternativas:** mover para a raiz (mistura com o legado, viola a separação).
- **Consequências:** o `.gitignore` do novo projeto só protege `novochico/`. A inclusão de um `.gitignore` na raiz e o tratamento de `codebaseantiga/.env` ficam em `PEND-02`.

## ADR-027 — Login exclusivamente com a conta Google institucional

Substitui ADR-008. **Decisão do responsável:** o ChicoChat+ só pode ser usado com e-mail institucional.

- **Contexto:** nem todo servidor tem e-mail institucional, mas a Prefeitura fixou esse requisito. Os registros MX de `pedroleopoldo.mg.gov.br` e de `pl.mg.gov.br` apontam para o Google (verificado em 06/11/2026), e o legado já usava `hd=pedroleopoldo.mg.gov.br`.
- **Problema:** manter e-mail e senha exigiria armazenar senhas, SMTP, verificação e redefinição, sem atender ninguém além de quem já tem a conta Google.
- **Decisão:** único método de login é Google OIDC, com `hd`, `email_verified` e domínio validados no servidor. Sem senha, sem SMTP. Biblioteca `openid-client`; sessões em tabela própria, com cookie `HttpOnly`, `Secure` e `SameSite=Lax`, guardando só o hash do identificador.
- **Justificativa:** a principal razão para adotar o Better Auth era não escrever fluxos de senha. Sem eles, restam um fluxo OIDC padrão e uma tabela de sessões, com menos dependência e menos superfície de ataque.
- **Alternativas:** Better Auth (funcionaria, mas é mais do que o necessário agora); manter senha (custo e risco sem público que o justifique).
- **Consequências:** quem não tiver conta institucional não acessa o sistema e usa outro canal de atendimento. Se o Google estiver indisponível, não há login. A confirmação de que toda conta institucional consegue autenticar acontece na F2.

## ADR-028 — Banco novo começa vazio, sem importar dados do legado

**Decisão do responsável.**

- **Contexto:** a exportação é possível, mas se optou por começar do zero.
- **Problema:** definir o que acontece com usuários, conversas, chamados e conteúdo antigos.
- **Decisão:** não há importador. Usuários são criados no primeiro login. Conteúdo inicial vem do seed, escrito a partir do que está versionado no legado. O legado não é acessado em produção.
- **Justificativa:** simplifica a F10, elimina risco de vazamento na migração e descarta dados de qualidade incerta, como eventos e mensagens forjáveis.
- **Alternativas:** migração completa de usuários, conversas e chamados (mais risco e pouco valor para o novo sistema); só conteúdo de configuração (ainda possível como referência, sem dados de pessoas).
- **Consequências:** histórico e métricas recomeçam. Links de transcrição presentes em chamados antigos dependem do sistema antigo. A retirada do legado, incluindo o destino dos dados pessoais guardados nele, precisa de decisão própria (`PEND-07`).

## ADR-029 — GLPI sem instância de teste: fakes, GLPI local e homologação controlada

**Decisão parcial do responsável:** não existe instância de teste.

- **Contexto:** os contratos com o GLPI só foram observados no código; a instância real é produção.
- **Problema:** validar a integração sem poluir a fila real de chamados.
- **Decisão:** validação em três níveis: (1) fakes HTTP nos testes automatizados; (2) GLPI oficial em Docker, na mesma versão da instância, só no ambiente local, para conferir contratos e `/api.php/<versão>/doc`; (3) homologação em produção com número mínimo de chamados marcados como teste, com o responsável presente e autorização naquele momento.
- **Justificativa:** o nível 2 detecta quase todo erro de contrato sem tocar em produção; o legado já tem precedente de "chamado de teste" para o nível 3.
- **Alternativas:** usar só fakes (contratos não confirmados até a estreia); testar só em produção (polui a fila e arrisca o atendimento).
- **Consequências:** é preciso informar a versão do GLPI em produção (`PEND-05`). Configurações próprias da instância, como perfis e entidades, só são confirmadas no nível 3.

## ADR-030 — Instruções do agente em duas camadas, editadas em linguagem natural

Substitui ADR-015. **Pedido do responsável:** alterar o comportamento do agente escrevendo em linguagem natural, com a IA redigindo as instruções.

- **Contexto:** regras de atendimento mudam: a de impressoras, por exemplo, já mudou mais de uma vez. O painel antigo tinha categorias, tópicos e fluxos, mas boa parte não chegava à IA, e regras como SEI, Sonner e Repros ficavam presas no código.
- **Problema:** dar autonomia à TI sem deploy e sem permitir que uma edição enfraqueça regras de segurança.
- **Decisão:**
  1. **Regras fixas no código:** segurança, dados pessoais, formato de resposta, marcadores e triagem. Não editáveis.
  2. **Instruções de atendimento no banco:** um único documento em texto, versionado. Só um fica publicado por vez.
  3. **Assistente de instruções:** o admin descreve a mudança em linguagem natural; a IA devolve o documento revisado, um resumo e os conflitos encontrados. O admin compara, ajusta, testa em um chat de ensaio e publica. **A IA nunca publica.**
  4. Todo publicar guarda autor, data e pedido original, e qualquer versão anterior pode ser restaurada.
  5. Categorias, tópicos e fluxos deixam de existir como cadastro para a IA. Permanece só o cadastro simples dos cards da tela inicial.
- **Justificativa:** um documento único permite que a IA encontre contradições, o admin leia exatamente o que vale, e o histórico mostre o que mudou. O texto livre também acomoda regras que exigem discernimento, como as da Repros, que não caberiam bem em campos.
- **Alternativas:** editar o texto sem assistente (menos acessível e sem verificação de conflitos); cadastros estruturados como no legado (rígidos e, na prática, ignorados); publicação direta pela IA (mudança institucional sem revisão humana); ajustar via deploy (dependência de desenvolvedor).
- **Consequências:** a qualidade do atendimento depende do que é publicado, por isso o ensaio vem antes da publicação. As regras fixas têm prioridade expressa no prompt. Se surgir decisão que o sistema precise tomar sozinho, como atribuição automática no GLPI, ela vira campo próprio, não texto.

## ADR-031 — Legado em produção em paralelo e repositório público

**Decisão do responsável.**

- **Contexto:** o ChicoChat+ antigo é vital e não pode sair do ar durante a reconstrução. O repositório `chicochatagent` permanecerá público por enquanto, incluindo `codebaseantiga/`.
- **Problema:** conviver com as falhas conhecidas do legado e desenvolver em repositório aberto.
- **Decisão:** o risco das falhas do legado é aceito até a troca de sistemas, e o legado não será alterado. `docs/LEGACY_AUDIT.md` fica fora do Git, somente na máquina local, enquanto o legado estiver no ar. Nada no repositório pode conter segredo, dado pessoal real ou registro de produção.
- **Justificativa:** o responsável priorizou a continuidade do serviço. Omitir a auditoria evita publicar um mapa das falhas, embora não elimine o risco, pois o código antigo continua legível.
- **Alternativas:** repositório privado (reduziria a exposição, sem corrigir as falhas); corrigir o legado (fora do escopo definido); publicar a auditoria (entrega o mapa pronto).
- **Consequências:** todo commit é público, portanto requer atenção redobrada. A auditoria não está em clones novos: se precisar dela em outra máquina, copie-a por meio seguro e mantenha um backup. Ao desligar o legado, reavaliar a publicação. Esta decisão pode mudar sem afetar a arquitetura.

## ADR-032 — Escolhas de ferramental da F0

Decisões pequenas e reversíveis tomadas na implementação da F0.

- **Contexto:** a F0 exigia escolher versões e detalhes que a documentação deixava em aberto.
- **Decisão:**
  1. **Node 26** (`.nvmrc`; `engines` `>=24`). A linha 26 já é LTS, confirmado em 06/11/2026.
  2. **TypeScript 6** com `moduleResolution: Bundler` em todos os pacotes. O código roda em desenvolvimento com `tsx`, sem extensões nos imports. O `shared` é consumido como código-fonte TypeScript.
  3. **Portas de desenvolvimento:** API em 3100 e PostgreSQL em 5433, porque 3000 e 5432 estavam ocupadas na máquina do responsável. O padrão de `PORT` na configuração continua 3000; o `.env.example` usa 3100.
  4. **PostgreSQL 17** no Compose de desenvolvimento, publicado só em `127.0.0.1`, com um segundo banco `chicochat_test` criado na inicialização do volume.
  5. **`concurrently`** como única dependência fora da lista de stack, apenas para `npm run dev` subir API e web juntas de modo portátil.
  6. **Fastify 5** com `LogController` (a opção `requestIdLogLabel` está depreciada) e id de requisição sempre gerado no servidor.
  7. Logs registram só método e caminho da requisição. A query string e o endereço do cliente ficam de fora.
- **Justificativa:** versões atuais, sem decisão arquitetural nova; a restrição de loopback e a omissão da query string seguem a seção K do `SONNET_CONTEXT.md`.
- **Alternativas:** `pnpm` (mais uma ferramenta a instalar), `npm-run-all2` no lugar de `concurrently` (equivalente), PostgreSQL 18 (mais novo; sem recurso necessário agora).
- **Consequências:**
  - A F10 precisa de um passo de build para produção. Hoje a API só executa com `tsx`, que não deve ser o servidor de produção.
  - O encerramento gracioso (`SIGTERM`) está implementado, mas não foi verificado no Windows, onde os sinais se comportam de outro modo. Verifique em Linux na F10.

## ADR-033 — Escolhas de modelagem da F1

Decisões pequenas e reversíveis tomadas ao implementar o banco.

- **Contexto:** a seção F do `SONNET_CONTEXT.md` deixava alguns detalhes em aberto, e a implementação mostrou três ajustes.
- **Decisão:**
  1. **E-mail sem `citext`:** `users.email` é `text`, com `CHECK (email = lower(email))` e índice único. Evita depender de uma extensão do PostgreSQL no servidor da Prefeitura (`PEND-08`); a aplicação normaliza o e-mail para minúsculas antes de gravar.
  2. **Enums do banco vêm de `@chicochat/shared`**, a mesma fonte usada por API e web. Acrescentar um valor exige uma nova migration.
  3. **Restrições além das listadas na seção F**, todas defensivas: aviso de privacidade com data e versão juntas; mensagem do usuário sem `source`; sucesso de chamado exige `glpi_ticket_id`; card de link externo exige URL; versão publicada exige `published_at`; conteúdo de instruções sem `<<`; tentativas de resolução não negativas.
  4. **Migrations aplicadas por código** (`npm run db:migrate`, migrador do Drizzle), nunca automaticamente na partida da API, usando `DATABASE_MIGRATION_URL` (opcional) para separar o usuário que altera o schema do usuário da aplicação.
  5. **Seed não destrutivo:** insere só o que falta (`ON CONFLICT DO NOTHING`) e só cria a versão 1 das instruções se não existir nenhuma versão. Repetir o seed nunca desfaz uma edição feita pelo painel.
  6. **`audit_log` sem bloqueio de `UPDATE`/`DELETE` no banco.** "Só inserção" é regra de aplicação. O reforço correto é revogar esses privilégios do usuário da aplicação, o que depende da definição de usuários do banco (`PEND-08`) e da retenção (`PEND-07`).
  7. **O card oculto `access`** do Anexo C permanece como linha de `categories`, sem uso até agora. Se continuar sem função, pode ser removido.
  8. **Ordem dos cards:** a ordem de exibição é proposta, pois o legado dependia da ordem de criação no banco. Só SEI e "Outra coisa?" ficam por último, como antes.
- **Justificativa:** manter o banco portátil, tornar as regras de integridade verificáveis pelo próprio PostgreSQL e proteger o conteúdo editado.
- **Alternativas:** `citext` (mais simples, porém exige extensão); migrar automaticamente na partida (arrisca alterar o banco de produção sem controle); `upsert` no seed (sobrescreveria edições).
- **Consequências:**
  - Números em `CHECK` e em `WHERE` de índice precisam passar por `lit()`; sem isso o Drizzle gera parâmetros (`$1`), inválidos em DDL. Um teste de migração em banco limpo protege contra isso.
  - O documento inicial das instruções é uma transposição que precisa de revisão da SATD antes de ir para produção; o resumo da versão 1 lista os pontos pendentes.

## ADR-034 — Escolhas de autenticação e controle de acesso da F2

Detalha a ADR-027 (login só com Google) e a ADR-009 (papéis no banco).

- **Contexto:** a F2 implementou o login, as sessões e o controle de acesso. Vários pontos estavam em aberto ou mostraram risco durante a implementação.
- **Decisão:**
  1. **Assinatura do `id_token` conferida explicitamente.** O `openid-client` não verifica a assinatura de um token recebido direto do endpoint do provedor por TLS, o que a especificação OIDC permite. Um teste mostrou que ele aceitava um token assinado por chave desconhecida. A conferência passa a ser feita com `jose`, usando as chaves publicadas pelo Google, só com o algoritmo `RS256`. É defesa em profundidade contra TLS interceptado. `jose` virou dependência de execução.
  2. **Política de identidade, no servidor:** o domínio do e-mail (comparação exata, nunca por sufixo) **e** o `hd` do Google precisam estar em `ALLOWED_EMAIL_DOMAINS`, e o e-mail deve estar verificado (apenas o booleano `true`). Sem `hd` (conta pessoal), a conta é recusada mesmo com e-mail do domínio. O `hd` pode diferir do domínio do e-mail, para domínios-alias. `GOOGLE_HOSTED_DOMAIN` é só uma dica de conta enviada ao Google e é opcional.
  3. **Login sem credenciais:** a API sobe e `/api/auth/google` redireciona para `/login?error=unavailable`, em vez de responder 503, porque é uma navegação do navegador. As falhas de login são sempre códigos genéricos (`LoginErrorCode`), sem detalhes.
  4. **Sessão:** cookie `chico_session` (ou `__Host-chico_session` com https), `HttpOnly`, `SameSite=Lax`, `Secure` quando https. O banco guarda o hash SHA-256 do identificador. Valem 8h de inatividade e 7 dias no total; a última atividade é gravada no máximo uma vez por minuto. O usuário é consultado a cada requisição, então rebaixar ou desativar vale de imediato.
  5. **Cookie temporário do login:** `chico_oidc`, assinado com `SESSION_SECRET` (`@fastify/cookie`), restrito a `/api/auth`, válido por 10 minutos e descartado em qualquer resultado. Guarda `state`, `nonce`, verificador PKCE e destino.
  6. **CSRF:** toda escrita exige `Origin` igual a `APP_PUBLIC_URL`, e a ausência também é recusada; roda antes da autenticação.
  7. **Acesso negado por padrão:** a rota exige login salvo `config.public: true`. `roles` e `requiresPrivacyAck` também são declarados na rota. O `routeCatalog` permite testar que nenhuma rota fica pública sem querer. Rota inexistente responde 404 sem login.
  8. **Limites:** 30 tentativas por 15 minutos por IP no início e na volta do login, e 600 por minuto por IP no geral. `TRUST_PROXY` (padrão `false`) controla se o IP vem do proxy.
  9. **Contas:** o mesmo e-mail com `sub` diferente é recusado (`ACCOUNT_CONFLICT`), sem unir contas automaticamente. O primeiro login simultâneo cria uma única conta. A conta desativada não entra e perde as sessões.
  10. **Primeiro administrador:** o usuário entra uma vez e depois se roda `npm run admin:grant -- <e-mail> [papel]`. A troca de papel é transacional, auditada (sem e-mail nem nome) e nunca remove o último administrador, mesmo com pedidos simultâneos (bloqueio de linha).
  11. **Aviso de privacidade:** a versão fica em `PRIVACY_NOTICE_VERSION` (`@chicochat/shared`). Mudar o texto exige mudar a versão, e todos passam a precisar aceitar de novo. O texto vem do sistema anterior, sem o emoji.
  12. **Web:** `react-router` (já na stack) com `/login` e as demais rotas protegidas; `AuthProvider` consulta `GET /api/me`. A página de saúde provisória da F0 foi substituída.
- **Justificativa:** cada ponto foi escolhido por fechar uma falha do sistema anterior (S-06, S-07 e relacionadas) ou por reduzir uma classe de erro: negar por padrão evita rota aberta por esquecimento, e só guardar hashes evita que um vazamento do banco entregue sessões.
- **Alternativas:** confiar só no `openid-client` (a conferência extra custa pouco); proibir contas sem `hd` apenas pela dica do Google (a dica não é uma validação); guardar o papel na sessão (ficaria desatualizado); lista de rotas protegidas em vez de negar por padrão (esquecer uma abre a rota).
- **Consequências e riscos:**
  - **IP compartilhado:** sem `TRUST_PROXY=true` atrás do proxy da Prefeitura, todos aparecem com o mesmo IP e dividem o limite de 30 tentativas por 15 minutos. Em um horário de pico de login isso pode bloquear usuários legítimos. Definir na F10 (`PEND-08`).
  - **Google real não testado:** os testes usam um provedor OIDC local com o `openid-client` real. O login com o Google de verdade depende das credenciais OAuth (`PEND-01`, `PEND-17`) e precisa ser conferido com contas institucionais reais.
  - A tela inicial gera um `GET /api/me` com resposta 401 para quem não entrou. O navegador a mostra no console, sem efeito.
  - Dependências além da lista de stack: `@fastify/cookie` e `jose`.

## ADR-035 — Design system: estrutura do Portal do Cidadão, cor do ChicoChat+

Detalha a ADR-007 (componentes próprios), a ADR-024 (tipografia) e a ADR-025 (contraste do azul). Descrição completa em `DESIGN_SYSTEM.md`.

- **Contexto:** a Prefeitura ainda não tem um design system único. O Portal do Cidadão tem um, documentado (tipografia, espaçamento, raios, alturas, movimento, componentes), que já usa Montserrat e Inter. A identidade do ChicoChat+ (paleta, logotipo) é oficial e deve permanecer.
- **Decisão:**
  1. Adotar do Portal a **estrutura**: escala de texto, escala de espaçamento em múltiplos de 4 px, pílula para o que é clicável, 16 px para cards e painéis, 8 px para etiquetas, altura de 48 px em botões e campos, alvo de toque de 44 px, foco de 3 px, sombra única só em quem flutua e as curvas e durações de movimento.
  2. Manter do ChicoChat+ a **cor**: `#FBFBFB`, `#111110` e `#24BCEC`, com texto `#111110` sobre o azul (ADR-025). O papel do azul escuro do Portal (menu, hover e foco) é do `#111110` no tema claro e do azul no escuro. `danger` e `warning` vêm do Portal (`#8a1c13` e `#9a5200`), com variantes para o escuro.
  3. Não adotar do Portal o gradiente do topo (seção I.7) nem o fundo cinza com cards brancos: aqui o fundo é `#FBFBFB` e a separação é por tom e espaço.
  4. Títulos em Montserrat 500 (títulos 1 e 2) e 600 (título 3), como no Portal. Isto substitui o "600/700" da seção I.3.
  5. Tailwind v4 com os tokens da marca; `@theme` zera os padrões, então telas só usam tokens. Tema por `data-theme`, aplicado por `public/theme-init.js` antes da primeira pintura; sem script em linha, para a CSP da F9.
  6. Fontes variáveis em WOFF2 via `@fontsource-variable/*`, só o subconjunto latino.
  7. `Markdown` com `react-markdown` e `remark-gfm`, lista fechada de elementos, sem HTML, sem imagem e com `urlTransform` que só aceita `http`, `https` e `mailto`.
- **Justificativa:** quem usa o Portal e o ChicoChat+ reconhece a mesma família, e cada sistema mantém a sua marca. As regras do Portal vêm de medições de acessibilidade e de usabilidade documentadas por ele.
- **Alternativas:** copiar as cores do Portal (apagaria a identidade do ChicoChat+); ignorar o Portal (dois sistemas municipais sem relação visual).
- **Consequências:**
  - Dependências além da lista inicial: `@fontsource-variable/inter`, `@fontsource-variable/montserrat`, `@tailwindcss/vite`, `axe-core` e `@testing-library/user-event` (teste).
  - Se a Prefeitura publicar um design system oficial, os tokens em `tokens.css` e `global.css` são o único ponto de ajuste.
  - `vite.config.ts` lê só a `PORT` do `.env`: `loadEnv` também leva o `NODE_ENV` do arquivo, e um `.env` de desenvolvimento fazia o `vite build` gerar um build de desenvolvimento.

## ADR-036 — Escolhas do chat e da integração com a IA (F4)

Detalha as ADR-010, 011, 012 e 020.

- **Contexto:** a F4 implementou a conversa, o stream, a triagem no servidor e a IA atrás de uma interface. Alguns pontos estavam em aberto.
- **Decisão:**
  1. **Interface `LlmClient`** com um único método, `streamChat`. `generateJson` entra na F5, quando houver quem o use. Implementações: Gemini (`@google/genai`), IA de desenvolvimento (`AI_PROVIDER=fake`, recusada em produção) e duplos de teste com roteiro.
  2. **Sem chave do Gemini a API sobe**, e o chat responde 503 `AI_UNAVAILABLE`; a interface oferece o portal do GLPI (`GLPI_PORTAL_URL`). Isto contraria a tabela J, que marcava a chave como obrigatória, para permitir desenvolver e implantar por etapas.
  3. **Erros anteriores ao primeiro trecho são HTTP**, não evento SSE: o servidor abre a conexão com a IA antes de responder e só então começa o stream. A mensagem do usuário já fica gravada, e repetir o mesmo texto a reaproveita (RF-028).
  4. **Uma resposta por conversa por vez** (trava em memória, 409) e **20 mensagens por minuto por usuário** (em memória, 429). O limite geral por IP continua existindo.
  5. **Filtro de marcadores** retém só o final do texto que ainda pode virar marcador; um marcador cortado no fim da resposta é descartado, nunca exibido. Marcadores são detectados no texto bruto.
  6. **Escalonamento por frase** (fallback do legado) vale só em resposta completa.
  7. **Cache do primeiro turno** guarda o texto bruto (com o marcador de tentativa, que continua contando); não guarda resposta que escala, com cara de dado pessoal ou curta, nem pergunta com e-mail, IP ou sequência de 5+ dígitos. A chave inclui a versão do prompt.
  8. **Modo de teste do administrador** persiste na conversa (`ticket_form_test_mode`, migration 0001), para sobreviver a recarregar a página.
  9. **Cliente sem TanStack Query**: a lista de conversas e os atalhos usam `fetch` em hooks próprios. A dependência não se justificou na F4.
  10. A tela inicial não repete o logotipo, já presente no cabeçalho.
- **Consequências:** o formulário de chamado ainda não existe (F5): a interface mostra o aviso de abertura liberada e o link do portal. O login real e o Gemini real continuam sem verificação até as credenciais entrarem no `.env`.

## ADR-037 — Escolhas da abertura de chamado no GLPI (F5)

Detalha as ADR-012, 013 e 017 e a seção G.

- **Contexto:** a F5 implementou o formulário, o resumo por IA, a duplicidade e o cliente do GLPI. Não há GLPI de teste (ADR-029) e a instância real não foi consultada (PEND-05).
- **Decisão:**
  1. **Cliente do GLPI** atrás de uma interface de três operações (buscar solicitante, criar chamado, ligar solicitante). `GLPI_PROVIDER=fake` simula em desenvolvimento e é recusado em produção. Sem credenciais, a API sobe e a abertura responde 503 `GLPI_UNAVAILABLE` com o portal. Credenciais pela metade impedem a partida.
  2. **Resultado desconhecido** (`unknown`) vale para timeout depois de enviar e para 2xx sem número. Só erros que garantem que nada chegou (conexão recusada, DNS, falha do token) são `failed` com reenvio permitido. Nunca há reenvio automático.
  3. **Idempotência:** a tentativa nasce `pending` com a chave única da conversa; a mesma chave devolve o resultado gravado (HTTP 200) e, enquanto a primeira corre, responde 409. Depois de falha definitiva, a pessoa usa uma chave nova; depois de falha de rede, a interface reusa a mesma, o que nunca duplica.
  4. **Resposta HTTP:** 201 só quando o chamado foi criado agora. Falha e resultado desconhecido voltam como 200, com `status` no corpo.
  5. **Resumo:** o texto do Anexo B é gerado do documento e conferido por teste; saída validada (seis seções na ordem, título até 80, urgência de 1 a 5); três tentativas, depois contingência sem transcrição. O modelo é `GEMINI_SUMMARY_MODEL`, sem fila (o resumo tem as próprias tentativas). `generateJson` passou a fazer parte de `LlmClient`.
  6. **Duplicidade:** limiares da seção G.6 reproduzidos com teste nos valores exatos. O incidente coletivo conta usuários distintos **excluindo o próprio** e devolve só contagem; nenhum título de outra pessoa sai do servidor. Os chamados parecidos não trazem link, porque o endereço do chamado no portal não está documentado.
  7. **Corpo estrito:** nome e e-mail do solicitante vêm da sessão; qualquer campo a mais no corpo é recusado.
  8. **Modo de teste:** só `admin`, sem IA, categoria "Teste", fora de métricas, duplicidade e último setor, sem marcar a conversa como escalada.
  9. **Último setor** vem da última tentativa real, sem coluna nova.
  10. **Sem link de transcrição** no texto do chamado: ele depende da F6.
- **Consequências e riscos:**
  - **Contrato real não verificado:** o cliente foi testado contra um servidor HTTP falso, não contra o GLPI. Caminho do token, filtro de usuário, `TeamMember` e `request_type` dependem de PEND-05. A primeira abertura real deve ser um chamado de teste, com o responsável presente.
  - Uma tentativa `pending` abandonada por queda do processo fica pendente para sempre e bloqueia aquela chave (409). A limpeza fica para a F9.
  - "Meus chamados" ainda não existe (F6): a mensagem do resultado desconhecido o cita, como manda a especificação.

## ADR-038 — Meus chamados e transcrição (F6)

Detalha as ADR-016 e 037 e a seção G.7.

- **Contexto:** a F6 lista os chamados do usuário e dá ao técnico o contexto da conversa, sem expor dados.
- **Decisão:**
  1. **Listagem** (`GET /api/tickets/mine`): o solicitante é achado pelo e-mail **da sessão**; nada do cliente escolhe de quem são os chamados. Une a lista do GLPI (`user_recipient`, até 50, por atualização) aos números registrados aqui, buscados um a um (5 por vez). O que o GLPI não devolver fica com o registro local.
  2. **Sem cadastro no GLPI** (`requester_not_found`) e **GLPI fora do ar** (`glpi_unavailable`) têm aviso próprio e mostram o registro local, sem situação nem descrição, em vez de uma lista vazia.
  3. **Texto plano:** o conteúdo do GLPI passa por `html-to-text` até parar de mudar (decodifica entidades, remove marcas, descarta imagem, script, estilo e endereço de link), tira as marcas de markdown do próprio sistema e limita a 4000 caracteres. A interface desenha como texto, nunca como HTML nem markdown.
  4. **Datas:** o GLPI manda a hora sem fuso; é tratada como `America/Sao_Paulo` (UTC-3) e a tela formata sempre nesse fuso.
  5. **Transcrição:** retrato das mensagens `user` e `assistant` no momento da abertura (até 60), gravado antes da chamada ao GLPI para o link entrar no texto do chamado. Token de 256 bits em base64url; só o hash SHA-256 é guardado. Chamado de teste e conversa sem mensagens não geram transcrição. Falha definitiva na abertura apaga o retrato; resultado desconhecido o mantém, porque o chamado pode existir.
  6. **Acesso** (`GET /api/transcripts/:token`): dono, `tecnico` e `admin`. Token malformado, inexistente ou de outra pessoa recebem o mesmo 404. **Todo** acesso, inclusive o do dono, gera registro de auditoria, só com papel e se é o dono, sem conteúdo. Sem login a tela leva ao login e volta.
  7. **Dependência nova:** `html-to-text` (e seus tipos), por decodificar entidades e tratar HTML de forma testada.
- **Consequências e riscos:**
  - O formato real da resposta do GLPI (campos, status e datas) segue sem verificação (PEND-05). A listagem foi testada contra um servidor falso.
  - Técnicos sem conta com papel não leem transcrições (PEND-10).
  - O texto do chamado criado antes da F6 não tem link; o link só existe nos chamados novos.
  - A tela de "Meus chamados" não tem paginação: são no máximo 50.

## ADR-039 — Avaliação, eventos e encerramento por inatividade (F7)

Detalha a ADR-018.

- **Contexto:** a F7 fecha o ciclo: pedir a avaliação, registrar os eventos que faltavam e encerrar as sessões inativas.
- **Decisão:**
  1. **Avaliação** (`POST /api/conversations/:id/feedback`): nota de 1 a 5, sugestão opcional de até 1000 caracteres, corpo estrito. Só o dono, e só depois de um chamado aberto de verdade (`escalated`) ou de uma resolução confirmada (`resolved`); antes disso, 409. **Uma por conversa**, garantida pela restrição única do banco: envios simultâneos gravam uma só, e a segunda recebe 409 "já enviada". A avaliação aponta para o chamado mais recente aberto de verdade, quando houver.
  2. **`rating_received`** leva só a nota e se há sugestão, nunca o texto. Falhar ao registrar qualquer evento não desfaz a operação principal.
  3. **Estado na conversa:** `triage.feedback` é `unavailable`, `available` ou `given`, calculado no servidor.
  4. **"Pular"** é guardado no navegador, por conversa: o pedido não volta nela nem ao reabri-la. O servidor continua dizendo "disponível", porque pular não é uma resposta que o sistema precise registrar.
  5. **Regex de resolução mantida** (B-04): os botões "Resolveu / Não resolveu" dependem de aprovação (PEND-18) e não foram criados.
  6. **Encerramento por inatividade:** tarefa periódica (5 em 5 minutos, uma varredura por vez, também na partida) fecha as conversas sem atividade há 30 minutos. O fim é o instante em que a sessão expirou, não o da varredura. Sem desfecho vira `no_outcome`; `resolved` e `escalated` permanecem. Gera `conversation_finished` com o desfecho. Repetir a varredura não fecha nem registra de novo.
  7. **Voltar a conversar** depois do fechamento reabre a conversa (`finished_at` nulo, `no_outcome` volta a nulo) e abre outra sessão de atendimento, que gera outro `conversation_finished` ao fechar.
  8. **Testes de integração** passam a ter 30 s por teste: cada arquivo cria um banco e roda em paralelo, e com a máquina carregada os 5 s padrão geravam falhas que não eram do código.
- **Consequências e riscos:** a tarefa roda no processo da API (uma instância, ADR-003); com mais de uma, as varreduras se repetiriam sem dano, mas sem ganho. "Pular" não é medido.
