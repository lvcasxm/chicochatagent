# Operação e implantação do ChicoChat+

Guia para quem instala, atualiza e cuida do sistema no servidor. Nada aqui contém segredos: os
valores de verdade ficam só no arquivo `deploy/production.env` do servidor, que não é versionado.

> **Esta é a proposta da F10.** O plano de virada (seção 7) e as decisões que dependem da
> Prefeitura (PEND-07 e PEND-08) precisam de aprovação antes de qualquer implantação real.
> Implantar só acontece com autorização explícita.

## 1. Visão geral

Um contêiner de aplicação (a API, que também serve a interface na mesma origem) e um PostgreSQL,
ligados pelo `compose.prod.yml`. O HTTPS fica no proxy reverso da Prefeitura, que encaminha para
`127.0.0.1:3000` do servidor.

```
navegador ──HTTPS──▶ proxy reverso ──HTTP──▶ 127.0.0.1:3000 (app) ──▶ db (PostgreSQL, sem porta publicada)
```

- A imagem não leva segredo nenhum: as variáveis entram na hora de executar.
- O banco começa **vazio** (ADR-028): o sistema antigo não é migrado. Quem passa a existir é quem faz o primeiro login.
- A aplicação é uma instância só (ADR-003). Os limites por pessoa e a tarefa de encerrar conversas vivem no processo.

## 2. Requisitos do servidor (PEND-08)

| Item | Mínimo |
|---|---|
| Sistema | Linux com Docker Engine 24+ e Docker Compose v2 |
| Recursos | 2 vCPU, 2 GB de RAM, 20 GB de disco (o volume do banco cresce com o uso) |
| Rede de saída | HTTPS para `generativelanguage.googleapis.com` (Gemini), `accounts.google.com` e `oauth2.googleapis.com` (login) e para o GLPI da Prefeitura |
| Rede de entrada | só o proxy reverso fala com a porta da aplicação; o banco não é exposto |
| Domínio | um endereço https definitivo (veja a seção 8: ele aparece em links de chamados) |

## 3. Primeira implantação

1. **Obter o código** na versão aprovada e entrar na pasta do projeto.
2. **Criar o ambiente:**
   ```bash
   cp deploy/production.env.example deploy/production.env
   chmod 600 deploy/production.env
   ```
   Preencha tudo. Pontos de atenção:
   - `APP_PUBLIC_URL`: o endereço https exato, sem barra final. Ele define o login e a origem aceita nas escritas.
   - `SESSION_SECRET`: 32 caracteres aleatórios ou mais (`openssl rand -base64 48`).
   - `TRUST_PROXY=true`: obrigatório atrás do proxy; sem isso todos dividem o limite de login do IP do proxy.
   - `POSTGRES_PASSWORD` e a senha dentro de `DATABASE_URL` precisam ser a mesma.
   - Em produção, `AI_PROVIDER=fake` e `GLPI_PROVIDER=fake` são **recusados**: a aplicação não sobe sem as credenciais reais.
3. **Google:** no console do Google Cloud, cadastre `https://<APP_PUBLIC_URL>/api/auth/google/callback` como URI de redirecionamento autorizado.
4. **Subir:**
   ```bash
   docker compose -f compose.prod.yml --env-file deploy/production.env up -d --build
   ```
   O serviço `migrate` roda antes da aplicação (migrations e seed) e termina; a aplicação só inicia se ele terminar sem erro.
5. **Conferir:**
   ```bash
   docker compose -f compose.prod.yml --env-file deploy/production.env ps      # app "healthy"
   curl -s http://127.0.0.1:3000/api/health                                    # {"status":"ok","db":"up"}
   ```
6. **Primeiro administrador:** a pessoa entra uma vez pelo login do Google; depois:
   ```bash
   docker compose -f compose.prod.yml --env-file deploy/production.env exec app \
     node_modules/.bin/tsx apps/api/scripts/admin-grant.ts nome.sobrenome@dominio.gov.br
   ```
   Os demais papéis (`tecnico`, `admin`) são dados pela tela "Usuários e papéis".
7. **Verificações com credenciais reais** (seção 9) antes de abrir para os servidores.

## 4. Proxy reverso

Requisitos para o proxy da Prefeitura (exemplo em nginx; adapte ao produto em uso):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # sobrescreve: nunca repasse o que veio do cliente
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;          # as respostas do chat chegam em stream (SSE)
    proxy_read_timeout 120s;      # a IA e as exportações podem demorar
}
```

- A aplicação já envia HSTS e a política de conteúdo (CSP); o proxy não precisa repeti-los.
- O proxy deve **sobrescrever** `X-Forwarded-For`, não acrescentar ao que o cliente mandou, porque com `TRUST_PROXY=true` esse cabeçalho define o IP usado nos limites.
- A aplicação só aceita escritas com o cabeçalho `Origin` igual a `APP_PUBLIC_URL`. O proxy não pode removê-lo.

## 5. Operação do dia a dia

| Tarefa | Comando |
|---|---|
| Ver o estado | `docker compose -f compose.prod.yml --env-file deploy/production.env ps` |
| Logs da aplicação | `docker compose -f compose.prod.yml --env-file deploy/production.env logs -f app` |
| Reiniciar | `docker compose -f compose.prod.yml --env-file deploy/production.env restart app` |
| Parar tudo (os dados ficam) | `docker compose -f compose.prod.yml --env-file deploy/production.env down` |

- Os logs são JSON, sem conteúdo de conversa, e-mail, nome, IP de máquina nem token.
- Reiniciar zera os limites por pessoa (ficam na memória) e derruba as respostas em andamento; as conversas ficam no banco.
- **Nunca** use `down -v`: o `-v` apaga o volume do banco.

### Atualizar para uma nova versão

1. **Faça um backup** (seção 6) e confira com `verify-backup.sh`.
2. Obtenha o código da versão nova e rode o mesmo `up -d --build` da primeira implantação. As migrations novas rodam sozinhas, uma vez.
3. Confira `ps` e o `/api/health`.

As migrations são **só para frente**. Voltar para a versão anterior do código não desfaz uma migration: se a versão nova mudou o banco de forma incompatível, a reversão é voltar o código **e** restaurar o backup tirado no passo 1 (o que perde o que foi feito depois dele). Por isso o backup antes de atualizar não é opcional.

## 6. Backup e restauração

O backup é um `pg_dump` completo do banco. **Ele contém dados pessoais e o conteúdo das conversas**: guarde com acesso restrito e, se sair do servidor, criptografado.

```bash
deploy/backup.sh /var/backups/chicochat              # cria chicochat-AAAAMMDDTHHMMSSZ.dump
deploy/verify-backup.sh /var/backups/chicochat/<arquivo>.dump
```

- `backup.sh` confere que o arquivo abre e lista o conteúdo.
- `verify-backup.sh` **restaura de verdade** em um banco temporário, compara com o banco vivo (contagens de pessoas, conversas, mensagens, chamados, avaliações, auditoria, cards, versões das instruções e migrations) e apaga o temporário. Não toca no banco da aplicação.
- Faça um backup por dia (exemplo de `cron`, como o usuário que opera o Docker):
  ```cron
  15 2 * * * cd /opt/chicochat && deploy/backup.sh /var/backups/chicochat >> /var/log/chicochat-backup.log 2>&1
  ```
- Rode `verify-backup.sh` pelo menos uma vez por mês e depois de qualquer mudança na infraestrutura.
- **Quantos backups guardar e por quanto tempo** é decisão de retenção da Prefeitura (PEND-07); este documento não define prazo.

### Restaurar (desastre ou volta de versão)

```bash
docker compose -f compose.prod.yml --env-file deploy/production.env stop app
deploy/restore.sh /var/backups/chicochat/<arquivo>.dump       # pede para digitar o nome do banco
docker compose -f compose.prod.yml --env-file deploy/production.env up -d
```

O `restore.sh` **substitui** o banco inteiro (derruba as conexões, recria vazio e restaura). Sem o nome do banco digitado, nada acontece. Depois, `up -d` roda `migrate` de novo, que aplica o que faltar para a versão de código em uso.

## 7. Plano de virada e de reversão (proposta, precisa de aprovação)

O sistema antigo continua em produção até a validação do novo.

**Antes (nada disso depende do sistema antigo):**

- [ ] Servidor pronto, domínio e certificado definidos (PEND-08).
- [ ] Decisão sobre envio das falas ao Google, retenção e aviso de privacidade (PEND-07).
- [ ] Credenciais reais no `deploy/production.env`; login do Google funcionando.
- [ ] Verificações com credenciais reais feitas (seção 9).
- [x] Abertura de chamado real no GLPI (PEND-05). Verificada em 07/11/2026 com o responsável: três chamados reais chegaram ao GLPI com número, solicitante vinculado, resumo da IA e link da conversa.
- [ ] Backup e restauração testados no servidor novo (`verify-backup.sh` com "OK").
- [ ] Primeiro administrador criado e pessoas da SATD com papel `tecnico` (PEND-10).

**Validação em paralelo:**

1. O sistema novo roda num endereço próprio, sem divulgação ampla. A SATD e um grupo pequeno de servidores usam por um período combinado.
2. Acompanhe pela "Visão geral" (falhas, chamados, notas) e pela "Análise por IA".
3. Chamados abertos pelo novo sistema devem chegar ao GLPI com o resumo e o link da conversa funcionando.

**Virada:**

1. Combine a data e avise os servidores (o texto do aviso é da Prefeitura).
2. Aponte o endereço que os servidores já conhecem para o sistema novo (no proxy ou no DNS).
3. Mantenha o sistema antigo no ar e **somente leitura de fato** (sem divulgar), pelo período combinado.
4. Observe `ps`, logs e a "Visão geral" nas primeiras horas.

**Reversão (se algo grave aparecer):**

1. Aponte o endereço de volta para o sistema antigo (proxy ou DNS). É imediato porque o antigo continua no ar.
2. O sistema novo pode ficar no ar para diagnóstico; nada precisa ser apagado.
3. Chamados já abertos no GLPI continuam lá. As conversas do sistema novo ficam no banco novo; o sistema antigo não as vê.
4. Registre o motivo antes de tentar de novo.

**Depois:** só desligue o sistema antigo com autorização da Prefeitura. O destino dos dados pessoais do sistema antigo é a PEND-07 e não é decidido aqui.

## 8. Mover para outro servidor (por exemplo, do de teste para o do trabalho)

A implantação é repetível: o ambiente é um arquivo e o dado é um backup.

1. No servidor novo: seção 2 (requisitos) e passos 1 a 5 da seção 3, com o **mesmo** `APP_PUBLIC_URL` se possível.
2. No servidor antigo: pare a aplicação, tire um backup (`backup.sh`) e copie o arquivo por canal seguro.
3. No servidor novo, com o banco recém-criado e a aplicação parada: `restore.sh` e `up -d`.
4. Aponte o endereço para o servidor novo.

Atenção ao **endereço público**:

- O login do Google só aceita redirecionamentos cadastrados: se o endereço mudar, cadastre o novo (`/api/auth/google/callback`) no console do Google.
- O link para a conversa que vai no texto de cada chamado do GLPI usa `APP_PUBLIC_URL` **no momento da abertura**. Se o endereço mudar, os links dos chamados já abertos passam a apontar para o endereço antigo e deixam de funcionar. Usar o endereço definitivo desde a primeira implantação evita isso.
- Trocar `SESSION_SECRET` derruba as sessões abertas (todos entram de novo), o que não perde dados.

## 9. Verificações com credenciais reais (depois de preencher o `.env`)

Nada disto foi possível durante a construção, que usou IA e GLPI de mentira. Faça, na ordem:

1. **Login Google:** entrar com uma conta institucional; uma conta de outro domínio é recusada.
2. **Gemini:** uma conversa real recebe resposta em stream; rodar a suíte de avaliação do agente (`npm run eval:chat`, Anexo D) e conferir o caso S7 (regras fixas prevalecem sobre instruções conflitantes).
3. **GLPI (PEND-05):** abertura verificada em 07/11/2026 com o responsável: três chamados reais chegaram ao GLPI com número, solicitante vinculado, resumo da IA e link da conversa. Falta conferir "Meus chamados" para a mesma pessoa e o que um `tecnico` vê ao abrir o link.
4. **Painel:** "Pedir uma mudança" nas instruções (assistente), "Ensaiar" e "Análise por IA" com dados reais.
5. **Cabeçalhos:** `curl -sI https://<endereço>/` deve mostrar a política de conteúdo e o HSTS.
6. **Backup:** `backup.sh` e `verify-backup.sh` no servidor.

## 10. Pendências que afetam a operação

| Item | O que falta |
|---|---|
| PEND-05 | Abertura de chamado verificada (07/11/2026). Falta confirmar a listagem de "Meus chamados" com respostas reais |
| PEND-07 | Retenção, base legal, envio de falas ao Google e destino dos dados do sistema antigo |
| PEND-08 | Servidor, domínio, TLS, saída de rede e política de backup |
| PEND-10 | Contas dos técnicos e papel `tecnico` |
| PEND-12 | Envio de eventos ao Web App (`modules/reporting`): não implementado, aguarda aprovação |
