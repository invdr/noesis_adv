#!/bin/sh
set -eu

# Compose gives this container the same raw credentials as Postgres. Encode all
# URL components here so passwords such as `pa:ss@word` remain valid for Prisma.
urlencode() {
  bun -e 'console.log(encodeURIComponent(process.argv[1]))' "$1"
}

: "${POSTGRES_DB:=noesis}"
: "${POSTGRES_USER:=noesis}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

database_user="$(urlencode "$POSTGRES_USER")"
database_password="$(urlencode "$POSTGRES_PASSWORD")"
database_name="$(urlencode "$POSTGRES_DB")"
export DATABASE_URL="postgresql://$database_user:$database_password@postgres:5432/$database_name?schema=public"

exec sh -c 'bun run --cwd backend prisma:deploy && bun run --cwd backend start'
