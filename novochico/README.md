# ChicoChat+

Assistente de TI da Prefeitura Municipal de Pedro Leopoldo. Documentação completa em [`docs/`](docs/) e instruções de trabalho em [`CLAUDE.md`](CLAUDE.md).

## Desenvolvimento local

Requisitos: Node.js 26 (veja `.nvmrc`), npm e Docker.

```bash
npm install
cp .env.example .env     # valores fictícios, só para desenvolvimento
npm run db:up            # PostgreSQL em 127.0.0.1:5433
npm run dev              # API em :3100 e web em :5173
```

Abra http://127.0.0.1:5173 e a página mostra o estado da API e do banco.

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
