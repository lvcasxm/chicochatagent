#!/usr/bin/env bash
# Restaura um backup do ChicoChat+ em um banco.
#
#   deploy/restore.sh <arquivo.dump> [banco-de-destino]
#
# Sem o segundo argumento, restaura em cima do banco da aplicação: PARE A APLICAÇÃO ANTES
# (docker compose -f compose.prod.yml stop app) e confirme digitando o nome do banco.
# Com um banco de destino diferente (ex.: para conferir um backup), ele é criado vazio.
#
# Variáveis: COMPOSE_FILE (padrão compose.prod.yml), ENV_FILE (padrão deploy/production.env).
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-deploy/production.env}"
DUMP="${1:?Uso: deploy/restore.sh <arquivo.dump> [banco-de-destino]}"
TARGET="${2:-}"

[ -f "$DUMP" ] || { echo "Arquivo não encontrado: $DUMP" >&2; exit 1; }

compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

APP_DB="$(compose exec -T db sh -c 'printf %s "$POSTGRES_DB"' </dev/null)"
TARGET="${TARGET:-$APP_DB}"

# O nome entra em SQL: só letras, números e _ .
case "$TARGET" in
  *[!A-Za-z0-9_]* | "") echo "Nome de banco inválido: $TARGET" >&2; exit 1 ;;
esac

psql_admin() {
  compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1' "$@"
}

if [ "$TARGET" = "$APP_DB" ]; then
  echo "Isto SUBSTITUI todo o conteúdo do banco '$APP_DB'. A aplicação precisa estar parada."
  read -r -p "Digite o nome do banco para continuar: " CONFIRM
  [ "$CONFIRM" = "$APP_DB" ] || { echo "Cancelado."; exit 1; }
  # Derruba as conexões abertas e recria vazio: restaurar por cima deixaria dados de sobra.
  echo "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TARGET' AND pid <> pg_backend_pid();" | psql_admin > /dev/null
  echo "DROP DATABASE IF EXISTS \"$TARGET\";" | psql_admin
else
  echo "DROP DATABASE IF EXISTS \"$TARGET\";" | psql_admin
fi
echo "CREATE DATABASE \"$TARGET\";" | psql_admin

compose exec -T db sh -c "pg_restore -U \"\$POSTGRES_USER\" -d \"$TARGET\" --no-owner --exit-on-error" < "$DUMP"
echo "Restaurado em '$TARGET'."
