#!/usr/bin/env bash
# Backup do banco do ChicoChat+ (pg_dump em formato custom, comprimido).
#
#   deploy/backup.sh [pasta-de-destino]
#
# O arquivo tem dados pessoais e o conteúdo das conversas: guarde com acesso restrito e, se sair
# do servidor, criptografado. Veja docs/OPERATIONS.md.
#
# Variáveis: COMPOSE_FILE (padrão compose.prod.yml), ENV_FILE (padrão deploy/production.env).
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-deploy/production.env}"
DEST="${1:-backups}"

compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

mkdir -p "$DEST"
chmod 700 "$DEST"
umask 077
FILE="$DEST/chicochat-$(date -u +%Y%m%dT%H%M%SZ).dump"

# O usuário e o banco vêm do próprio contêiner, que já os conhece.
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner' > "$FILE"

# Um dump vazio ou truncado não serve: confere que o arquivo abre e lista o conteúdo.
if ! compose exec -T db pg_restore --list < "$FILE" > /dev/null; then
  echo "Backup inválido: $FILE" >&2
  exit 1
fi

echo "$FILE"
