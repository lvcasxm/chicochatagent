# Revisão de segurança (F9)

Resultado da verificação dos achados S-01 a S-18 da auditoria do sistema anterior contra a
reconstrução. A tabela diz **o controle** que existe hoje e **onde ele é testado**. Os detalhes dos
achados ficam fora do repositório (ADR-031).

| Achado | Controle na reconstrução | Evidência |
|---|---|---|
| S-01 | Os chamados listados são os do e-mail **da sessão**; nada do cliente escolhe de quem são | `tickets/tickets.test.ts` (listagem), `http/access.test.ts` (401 sem login) |
| S-02 | Abrir chamado exige login, estado liberado pelo servidor e identidade da sessão; o corpo estrito recusa nome e e-mail | `tickets/tickets.test.ts` ("nome e e-mail vêm da sessão"), `http/limits.test.ts` |
| S-03 | Transcrição só para dono, `tecnico` e `admin`, com token de 256 bits (só o hash é guardado) e auditoria de todo acesso | `transcripts/transcripts.test.ts` |
| S-04 | Nenhuma rota do chat é aberta; login, limite por pessoa (15/min, 200/h) e limite global por IP | `http/access.test.ts`, `http/limits.test.ts`, `http/security.test.ts` |
| S-05 | O cliente só envia o texto; papéis e histórico vêm do banco; o texto vai em papel `user`, nunca no prompt do sistema | `chat/chat.test.ts` ("o texto do usuário vai em papel user") |
| S-06 | Nada de HTML da IA nem do GLPI: markdown sem HTML, texto plano para o GLPI, sessão em cookie `HttpOnly`, CSP sem script em linha | `web/components/components.test.tsx`, `lib/plain-text.test.ts`, `http/security.test.ts` |
| S-07 | O domínio é conferido no servidor, com `hd` verificado e comparação do domínio inteiro | `auth/policy.test.ts`, `auth/routes.test.ts` |
| S-08 | Não existe rota para o usuário alterar o próprio papel; só `admin` troca papéis, com auditoria e sem remover o último administrador | `admin/admin.test.ts` ("usuários e papéis"), `users/service.test.ts`, `http/access.test.ts` (catálogo de rotas) |
| S-09 | Nenhuma rota grava mensagem, evento ou papel vindo do cliente; mensagens e eventos nascem no servidor | `http/access.test.ts` (catálogo de rotas), `chat/chat.test.ts` |
| S-10 | A verificação de chamados parecidos usa o usuário da sessão e devolve só contagem, categoria e janela | `tickets/tickets.test.ts` ("chamados parecidos") |
| S-11 | Logs sem conteúdo, e-mail, nome, IP de máquina nem token | `auth/routes.test.ts` (saída do log), `tickets/tickets.test.ts` |
| S-12 | Erros de terceiros nunca chegam ao usuário; o detalhe técnico fica em log e auditoria | `http/error-handler.test.ts`, `tickets/tickets.test.ts` |
| S-13 | Não há envio de arquivos (PEND-14 não implementada); portanto não há depósito público | revisão de rotas (`http/access.test.ts`) |
| S-14 | Leitura de conversa, exportação, Análise IA, troca de papel e publicação de instruções geram auditoria; sem registro, sem leitura | `admin/admin.test.ts` |
| S-15 | O aceite do aviso de privacidade é gravado no servidor, por versão. **Retenção e base legal seguem abertas (PEND-07)**: depende de decisão da Prefeitura | `users/service.test.ts`, `http/access.test.ts` |
| S-16 | CSV com `'` na frente de células que começam com `=`, `+`, `-`, `@`, tab ou CR | `admin/csv.test.ts`, `admin/admin.test.ts` |
| S-17 | Sem CORS: mesma origem; nenhuma resposta traz `Access-Control-Allow-Origin` | `http/security.test.ts` |
| S-18 | Nenhum e-mail ou identificador institucional no código, nas migrations ou nos seeds; o primeiro admin vem pela linha de comando | `http/security.test.ts` (varredura), `db/seed/seed-data.test.ts` |

## Controles transversais conferidos nesta fase

- **Cabeçalhos:** CSP (`default-src 'self'`, `script-src 'self'` sem `unsafe-inline`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri` e `form-action` na própria origem), HSTS só com endereço https, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, isolamento de origem cruzada. Respostas da API saem com `Cache-Control: no-store`. O estilo em linha continua permitido porque as primitivas do Radix (diálogo e lista) inserem `<style>` ao abrir (ADR-041).
- **Limites da seção K:** login 30 por 15 min por IP; global 600 por min por IP; por pessoa: mensagens 15/min e 200/h, abertura de chamado 5/10 min, `ticket-check` 20/min, `tickets/mine` 10/min, Análise IA 5/h, exportação 5/min. Atrás de proxy confiável (`TRUST_PROXY=true`) o limite por IP usa o IP do cliente; sem ele, o cabeçalho `X-Forwarded-For` é ignorado.
- **Desempenho:** a interface inicial pesa 206 KB de JavaScript e 6 KB de CSS, comprimidos (meta: 250 KB); a administração (78 KB) é carregada à parte. No E2E, a primeira resposta do chat com a IA de mentira chega em menos de 2 s.
- **Acessibilidade:** o axe, no navegador de verdade e com contraste, roda em login, chat, formulário de chamado, Meus chamados e nas telas de administração, nos dois temas, em desktop e celular. O E2E encontrou e corrigiu áreas rolantes sem acesso por teclado e um diálogo de chamado que não fechava.
- **Dependências:** `npm audit --omit=dev` sem vulnerabilidades (07/11/2026).
- **Tentativas de chamado abandonadas:** uma tentativa `pending` com mais de 10 minutos vira `unknown`, nunca é reenviada sozinha e aparece na lista de falhas do painel.

## Pendências desta revisão

- **PEND-07** (retenção, base legal, envio de falas ao Google): decisão da Prefeitura.
- **S-15**: o item de retenção só fecha com a PEND-07.
- `/security-review` e a revisão de leitor de tela e aparelho físico são feitas por pessoas, fora destes testes.
