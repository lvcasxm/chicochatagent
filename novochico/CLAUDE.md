# ChicoChat+ — instruções do projeto

Canal institucional de atendimento de TI da Prefeitura Municipal de Pedro Leopoldo (MG). Um agente de IA (Google Gemini) atende servidores municipais, investiga o problema e, quando necessário, abre chamados no GLPI. Este repositório contém a reconstrução completa e independente do sistema antigo, feito no Lovable.

**Situação atual:** arquitetura proposta, aguardando aprovação. **Não inicie nenhuma fase de implementação sem aprovação explícita do responsável.**

## Antes de implementar

Leia, nesta ordem:

1. [docs/SONNET_CONTEXT.md](docs/SONNET_CONTEXT.md): manual funcional e técnico; requisitos, regras, schema, integrações, design.
2. [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): a fase atual e seus critérios.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): limites entre camadas e estrutura de diretórios.
4. [docs/DECISIONS.md](docs/DECISIONS.md): decisões já tomadas. Não as reabra sem motivo.

[docs/LEGACY_AUDIT.md](docs/LEGACY_AUDIT.md) registra o que foi encontrado no sistema antigo. Consulte-o quando precisar da origem de uma regra. **Esse arquivo é local e não vai para o Git** (ADR-031).

## Separação entre código antigo e novo

- `../codebaseantiga/` é **somente leitura**. É proibido alterar, criar, excluir, mover, formatar ou executar comandos que a modifiquem.
- Todo o desenvolvimento ocorre em `novochico/`. Ela é um projeto novo, não uma cópia renomeada.
- Use o legado para entender o que o sistema faz, não como ele deve ser construído. O conteúdo necessário já está na documentação. Só copie os ativos de marca listados em `SONNET_CONTEXT.md`, seção I.4.
- Não altere o `CLAUDE.md` nem outros arquivos da raiz do repositório sem autorização.

## Segurança: regras invioláveis

- **O repositório é público e o sistema antigo está em produção.** Todo commit é público. Não versione falhas do legado com detalhes de exploração, nem segredos, dados pessoais ou registros de produção.
- Backend controla identidade, autorização, liberação de chamado e categoria válida. Nunca confie no cliente nem na saída da IA para isso.
- Chaves de API e credenciais só no ambiente do servidor. Nunca no frontend, em arquivos versionados, logs, testes ou respostas.
- Não use dados reais da Prefeitura em testes, seeds ou exemplos.
- Não registre conteúdo de conversa, e-mail, nome, IP de máquina nem tokens em logs.
- Não renderize HTML vindo da IA ou do GLPI.
- Não colete CPF.
- Não invente políticas, promessas ou textos institucionais. Registre como pendência.
- Regras de atendimento que mudam ficam nas instruções editáveis, não no código. Regras de segurança e formato ficam no código (ADR-030).
- Não faça deploy, não conecte a serviços externos reais e não crie chamado real sem autorização explícita naquele momento.
- Operação destrutiva (exclusão, `DROP`, alteração de produção) exige autorização prévia. Migrations são só para frente.

## Papéis

**Opus 5.5** é responsável por arquitetura, auditoria, decisões, padrões, documentação e revisão dos resultados.

**Sonnet 5.5** é o principal executor. Implementa a fase indicada, escreve testes, corrige erros e segue os padrões.

- Decisões pequenas e reversíveis podem ser tomadas e registradas no PR.
- Decisões que afetem outros módulos vão para `docs/DECISIONS.md`.
- Ambiguidade relevante, mudança de arquitetura ou nova dependência fora da stack: **pare, registre e pergunte**.
- Pendências (`PEND-xx`): siga o padrão indicado em `SONNET_CONTEXT.md`, seção N, ou pare quando o plano a marcar como bloqueante.

## Desenvolvimento

- Stack, limites e padrões são os documentados. Não adicione abstrações, recursos ou dependências além do solicitado.
- Toda fase termina com `npm run lint`, `npm run typecheck` e `npm test` passando, e critérios verificados. O que não puder ser verificado deve ser dito claramente.
- Interface: siga a seção I. Azul `#24BCEC` com texto `#111110`, nunca branco. Nada de aparência de template.
- Mudou comportamento documentado? Atualize o documento no mesmo trabalho.

## Versionamento

- Uma branch por fase ou correção: `feat/fNN-descricao`, `fix/descricao`. Nunca trabalhe direto em `main`.
- Commits em português, no imperativo, com um assunto por commit. Ex.: `feat(tickets): adiciona idempotência na abertura`.
- Faça commit e push somente quando o responsável pedir.
- Nunca versione `.env`, credenciais ou exportações de dados.

## Comandos

Disponíveis após a F0:

```bash
docker compose up -d   # PostgreSQL de desenvolvimento
npm run dev            # web + API
npm run db:migrate     # aplica migrations
npm run db:seed        # conteúdo inicial, sem dados reais
npm run admin:grant -- <e-mail> [papel]   # papel de um usuário que já entrou (padrão: admin)
npm run lint && npm run typecheck && npm test
```
