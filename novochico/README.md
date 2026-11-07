# ChicoChat+

Assistente de TI da Prefeitura Municipal de Pedro Leopoldo. Documentação completa em [`docs/`](docs/) e instruções de trabalho em [`CLAUDE.md`](CLAUDE.md).

## Desenvolvimento local

Requisitos: Node.js 26 (veja `.nvmrc`), npm e Docker.

```bash
npm install
cp .env.example .env     # valores fictícios, só para desenvolvimento
npm run db:up            # PostgreSQL em 127.0.0.1:5433
npm run db:migrate       # cria as tabelas
npm run db:seed          # cards e instruções iniciais (seguro para repetir)
npm run dev              # API em :3100 e web em :5173
```

Para alterar o schema, edite `apps/api/src/db/schema/` e rode `npm run db:generate`; revise o SQL gerado antes de aplicar.

Abra http://127.0.0.1:5173. Sem as credenciais do Google (abaixo), a tela de login aparece e avisa que o login está indisponível.

Se o seu `.env` é anterior à F2, copie dele as variáveis novas do `.env.example` (`APP_PUBLIC_URL`, `SESSION_SECRET`, `ALLOWED_EMAIL_DOMAINS`) e gere um `SESSION_SECRET` aleatório; a API recusa subir sem elas.

## Login com Google

O sistema só aceita contas institucionais, por login com o Google.

1. No Google Cloud, crie um cliente OAuth do tipo **Aplicativo da Web**.
2. Cadastre o redirecionamento `http://127.0.0.1:5173/api/auth/google/callback` (troque pelo seu `APP_PUBLIC_URL`).
3. Coloque `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env`. **Nunca** em arquivos versionados.
4. Reinicie `npm run dev` e entre com uma conta do domínio de `ALLOWED_EMAIL_DOMAINS`.

### Primeiro administrador

O cadastro só acontece pelo login. Depois de entrar uma vez, promova a conta:

```bash
npm run admin:grant -- seu.nome@dominio.gov.br
```

## IA do chat

Por padrão a IA é o Gemini (`AI_PROVIDER=gemini`), que precisa de `GEMINI_API_KEY` no `.env`; sem a chave, o chat responde que o serviço está indisponível. Para desenvolver a interface sem chave, use `AI_PROVIDER=fake` (já no `.env.example`): a IA responde com um roteiro. O fake é recusado em produção. Depois de atualizar, rode `npm run db:migrate`.

O painel de administração (`/admin`, só para o papel `admin`) usa a mesma chave. A Análise IA e o assistente de instruções usam `GEMINI_INSIGHTS_MODEL` (padrão `gemini-2.5-flash`); com `AI_PROVIDER=fake` eles respondem com textos de desenvolvimento.

## Implantação

`Dockerfile` e `compose.prod.yml` (a API serve a interface; o banco não publica porta), com o modelo de ambiente em `deploy/production.env.example` e os scripts de backup e restauração em `deploy/`. O passo a passo, o proxy reverso, o plano de virada e como mover para outro servidor estão em [docs/OPERATIONS.md](docs/OPERATIONS.md). Nada é implantado sem autorização.

## Testes de ponta a ponta

`npm run e2e` sobe um banco novo (`chicochat_e2e`, no PostgreSQL do Compose), constrói a interface e a serve pela API com a IA e o GLPI de mentira, e roda a suíte no Chrome instalado, em quatro combinações: desktop e celular, tema claro e escuro. Precisa de `TEST_DATABASE_URL` no `.env`. Em produção, a API serve a interface quando `WEB_DIST_DIR` aponta para o build do web.

## GLPI

Por padrão o GLPI é de verdade (`GLPI_PROVIDER=glpi`), com as variáveis `GLPI_*` no `.env`; sem elas, a abertura de chamado responde que o sistema está indisponível. Para desenvolver sem GLPI, use `GLPI_PROVIDER=fake` (já no `.env.example`): os chamados são simulados. O fake é recusado em produção. **Nunca** teste contra o GLPI de produção sem o responsável presente (ADR-029).

## Verificação

```bash
npm run lint
npm run typecheck
npm test
```

Os testes de integração com o PostgreSQL usam `TEST_DATABASE_URL`; sem ele, são ignorados.

## Estrutura

- `apps/api`: API Fastify (módulos de negócio, integrações, persistência)
- `apps/web`: SPA React
- `packages/shared`: contratos entre web e API

Credenciais reais ficam apenas no `.env` local, que o Git ignora.
