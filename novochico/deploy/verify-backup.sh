#!/usr/bin/env bash
# Confere um backup de verdade: restaura em um banco temporário e compara com o banco vivo.
#
#   deploy/verify-backup.sh <arquivo.dump>
#
# Não toca no banco da aplicação. Rode depois de cada backup importante e, em rotina, ao menos uma
# vez por mês: backup que nunca foi restaurado é só uma esperança.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-deploy/production.env}"
DUMP="${1:?Uso: deploy/verify-backup.sh <arquivo.dump>}"
CHECK_DB="chicochat_verify_$(date +%s)"

compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

# Contagem de linhas das tabelas que importam, em um banco ($1).
counts() {
  compose exec -T db sh -c "psql -U \"\$POSTGRES_USER\" -d \"$1\" -At -v ON_ERROR_STOP=1" <<'SQL'
SELECT 'users=' || count(*) FROM users;
SELECT 'conversations=' || count(*) FROM conversations;
SELECT 'messages=' || count(*) FROM messages;
SELECT 'ticket_attempts=' || count(*) FROM ticket_attempts;
SELECT 'feedbacks=' || count(*) FROM feedbacks;
SELECT 'audit_log=' || count(*) FROM audit_log;
SELECT 'categories=' || count(*) FROM categories;
SELECT 'instruction_versions=' || count(*) FROM instruction_versions;
SELECT 'published_instructions=' || count(*) FROM instruction_versions WHERE status = 'published';
SELECT 'migrations=' || count(*) FROM drizzle.__drizzle_migrations;
SQL
}

APP_DB="$(compose exec -T db sh -c 'printf %s "$POSTGRES_DB"' </dev/null)"
cleanup() {
  echo "DROP DATABASE IF EXISTS \"$CHECK_DB\";" | compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres' > /dev/null 2>&1 || true
}
trap cleanup EXIT

# O banco vivo pode ter mudado depois do backup: as contagens são mostradas lado a lado para quem
# confere, e a verificação só falha no que não pode divergir (uma instrução publicada, mesmas migrations).
deploy/restore.sh "$DUMP" "$CHECK_DB" > /dev/null

RESTORED="$(counts "$CHECK_DB")"
LIVE="$(counts "$APP_DB")"

echo "--- restaurado ($CHECK_DB) ---"
echo "$RESTORED"
echo "--- banco vivo ($APP_DB) ---"
echo "$LIVE"

# Instruções publicadas: sempre exatamente uma. Migrations: as mesmas.
echo "$RESTORED" | grep -qx 'published_instructions=1' || { echo "FALHA: não há exatamente uma instrução publicada" >&2; exit 1; }
[ "$(echo "$RESTORED" | grep '^migrations=')" = "$(echo "$LIVE" | grep '^migrations=')" ] || { echo "FALHA: migrations diferentes" >&2; exit 1; }
echo "OK: o backup restaura e tem o conteúdo esperado."
