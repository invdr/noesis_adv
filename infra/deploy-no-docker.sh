#!/usr/bin/env bash
# Deploy Noesis on a VPS that already has nginx + PostgreSQL and no Docker.
# Intended for side-by-side hosting with another app that owns ports 80/443/3000.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${NOESIS_ENV_FILE:-$ROOT/infra/no-docker.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "No env file: $ENV_FILE" >&2
  echo "Copy infra/no-docker.env.example to infra/no-docker.env and fill secrets." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

NOESIS_DEPLOY_DIR="${NOESIS_DEPLOY_DIR:-/var/www/noesis_adv}"
NOESIS_RUN_USER="${NOESIS_RUN_USER:-noesis}"
NOESIS_RUN_GROUP="${NOESIS_RUN_GROUP:-$NOESIS_RUN_USER}"
NOESIS_HOME="${NOESIS_HOME:-/var/lib/noesis}"
NOESIS_FILES_DIR="${NOESIS_FILES_DIR:-/var/lib/noesis/files}"
NOESIS_DOMAIN="${NOESIS_DOMAIN:-noesis.catlg.ru}"
NOESIS_SERVER_NAMES="${NOESIS_SERVER_NAMES:-$NOESIS_DOMAIN}"
NOESIS_BACKEND_PORT="${NOESIS_BACKEND_PORT:-3001}"
NOESIS_BACKEND_HOST="${NOESIS_BACKEND_HOST:-127.0.0.1}"
NOESIS_BACKEND_SERVICE="${NOESIS_BACKEND_SERVICE:-noesis-backend}"
NOESIS_SITE_BUILDER_SERVICE="${NOESIS_SITE_BUILDER_SERVICE:-noesis-site-builder}"
NOESIS_NGINX_SITE="${NOESIS_NGINX_SITE:-noesis}"
NOESIS_RUNTIME_ENV="${NOESIS_RUNTIME_ENV:-/etc/noesis/backend.env}"
NOESIS_SSL_CERT="${NOESIS_SSL_CERT:-/etc/letsencrypt/live/catlg.ru-0001/fullchain.pem}"
NOESIS_SSL_KEY="${NOESIS_SSL_KEY:-/etc/letsencrypt/live/catlg.ru-0001/privkey.pem}"
POSTGRES_DB="${POSTGRES_DB:-noesis}"
POSTGRES_USER="${POSTGRES_USER:-noesis}"
SITE_URL="${SITE_URL:-https://$NOESIS_DOMAIN}"
CORS_ORIGINS="${CORS_ORIGINS:-$SITE_URL}"
COOKIE_SECURE="${COOKIE_SECURE:-true}"
SESSION_TTL_HOURS="${SESSION_TTL_HOURS:-12}"
CRM_BASE_URL="${CRM_BASE_URL:-$SITE_URL/crm}"
REBUILD_DEBOUNCE_SECONDS="${REBUILD_DEBOUNCE_SECONDS:-120}"
REBUILD_STALL_MINUTES="${REBUILD_STALL_MINUTES:-15}"
BUILD_POLL_SECONDS="${BUILD_POLL_SECONDS:-30}"
BUILD_KEEP_RELEASES="${BUILD_KEEP_RELEASES:-5}"
FILES_PUBLIC_BASE="${FILES_PUBLIC_BASE:-/files}"

export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root on the VPS." >&2
    exit 1
  fi
}

require_in_place_checkout() {
  install -d -m 0755 "$NOESIS_DEPLOY_DIR"
  local root_real deploy_real
  root_real="$(cd "$ROOT" && pwd -P)"
  deploy_real="$(cd "$NOESIS_DEPLOY_DIR" && pwd -P)"
  if [ "$root_real" != "$deploy_real" ]; then
    echo "This script deploys the current checkout in place." >&2
    echo "Run it from $NOESIS_DEPLOY_DIR or set NOESIS_DEPLOY_DIR=$root_real in $ENV_FILE." >&2
    exit 1
  fi
}

require_value() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ] || [[ "$value" == CHANGE_ME* ]]; then
    echo "Set $name in $ENV_FILE" >&2
    exit 1
  fi
}

as_postgres() {
  if command -v sudo >/dev/null 2>&1; then
    sudo -u postgres "$@"
  else
    runuser -u postgres -- "$@"
  fi
}

ensure_bun() {
  local source_bin=""
  if command -v bun >/dev/null 2>&1; then
    source_bin="$(command -v bun)"
  elif [ -x "$HOME/.bun/bin/bun" ]; then
    source_bin="$HOME/.bun/bin/bun"
  else
    echo "Installing Bun for deployment..."
    curl -fsSL https://bun.sh/install | bash
    source_bin="$HOME/.bun/bin/bun"
  fi

  if [ "$source_bin" != "/usr/local/bin/bun" ]; then
    install -m 0755 "$source_bin" /usr/local/bin/bun
  fi
  BUN_BIN="/usr/local/bin/bun"
  export BUN_BIN
  "$BUN_BIN" --version
}

ensure_run_user() {
  if [ "$NOESIS_RUN_USER" != "root" ] && ! id "$NOESIS_RUN_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "$NOESIS_HOME" --shell /usr/sbin/nologin "$NOESIS_RUN_USER"
  fi
  install -d -m 0755 "$NOESIS_HOME"
  if [ "$NOESIS_RUN_USER" != "root" ]; then
    chown "$NOESIS_RUN_USER:$NOESIS_RUN_GROUP" "$NOESIS_HOME"
  fi
  install -d -o "$NOESIS_RUN_USER" -g "$NOESIS_RUN_GROUP" -m 0755 "$NOESIS_FILES_DIR"
}

ensure_postgres_db() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql is not installed. Install PostgreSQL client/server first." >&2
    exit 1
  fi

  local role_exists db_exists
  role_exists="$(as_postgres psql -v ON_ERROR_STOP=1 -v role="$POSTGRES_USER" -At <<'SQL'
SELECT 1 FROM pg_roles WHERE rolname = :'role';
SQL
)"
  if [ "$role_exists" = "1" ]; then
    as_postgres psql -v ON_ERROR_STOP=1 -v role="$POSTGRES_USER" -v pass="$POSTGRES_PASSWORD" <<'SQL'
ALTER ROLE :"role" WITH LOGIN PASSWORD :'pass';
SQL
  else
    as_postgres psql -v ON_ERROR_STOP=1 -v role="$POSTGRES_USER" -v pass="$POSTGRES_PASSWORD" <<'SQL'
CREATE ROLE :"role" WITH LOGIN PASSWORD :'pass';
SQL
  fi

  db_exists="$(as_postgres psql -v ON_ERROR_STOP=1 -v db="$POSTGRES_DB" -At <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'db';
SQL
)"
  if [ "$db_exists" != "1" ]; then
    as_postgres createdb -O "$POSTGRES_USER" "$POSTGRES_DB"
  fi

  as_postgres psql -v ON_ERROR_STOP=1 -v db="$POSTGRES_DB" -v role="$POSTGRES_USER" <<'SQL'
GRANT ALL PRIVILEGES ON DATABASE :"db" TO :"role";
SQL
  as_postgres psql -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" -v role="$POSTGRES_USER" <<'SQL'
GRANT ALL ON SCHEMA public TO :"role";
ALTER SCHEMA public OWNER TO :"role";
SQL
}

urlencode() {
  "$BUN_BIN" -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' -- "$1"
}

write_runtime_env() {
  local runtime_dir
  runtime_dir="$(dirname "$NOESIS_RUNTIME_ENV")"
  install -d -m 0700 "$runtime_dir"

  local database_user database_password database_name database_url
  database_user="$(urlencode "$POSTGRES_USER")"
  database_password="$(urlencode "$POSTGRES_PASSWORD")"
  database_name="$(urlencode "$POSTGRES_DB")"
  database_url="postgresql://$database_user:$database_password@127.0.0.1:5432/$database_name?schema=public"
  cat > "$NOESIS_RUNTIME_ENV" <<EOF
NODE_ENV=production
DATABASE_URL=$database_url
PORT=$NOESIS_BACKEND_PORT
HOST=$NOESIS_BACKEND_HOST
CORS_ORIGINS=$CORS_ORIGINS
SESSION_TTL_HOURS=$SESSION_TTL_HOURS
COOKIE_SECURE=$COOKIE_SECURE
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
CRM_BASE_URL=$CRM_BASE_URL
BUILD_WORKER_TOKEN=${BUILD_WORKER_TOKEN:-}
REBUILD_DEBOUNCE_SECONDS=$REBUILD_DEBOUNCE_SECONDS
REBUILD_STALL_MINUTES=$REBUILD_STALL_MINUTES
BUILD_POLL_SECONDS=$BUILD_POLL_SECONDS
BUILD_KEEP_RELEASES=$BUILD_KEEP_RELEASES
SITE_URL=$SITE_URL
PUBLIC_YANDEX_MAPS_API_KEY=${PUBLIC_YANDEX_MAPS_API_KEY:-}
FILES_DIR=$NOESIS_FILES_DIR
FILES_PUBLIC_BASE=$FILES_PUBLIC_BASE
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
REMINDER_CRON_TOKEN=${REMINDER_CRON_TOKEN:-}
BACKUP_TELEGRAM_CHAT_ID=${BACKUP_TELEGRAM_CHAT_ID:-}
BACKUP_PASSPHRASE=${BACKUP_PASSPHRASE:-}
EOF
  chmod 0600 "$NOESIS_RUNTIME_ENV"
}

load_runtime_env() {
  set -a
  # shellcheck source=/dev/null
  . "$NOESIS_RUNTIME_ENV"
  set +a
}

render_template() {
  local src="$1"
  local dst="$2"
  "$BUN_BIN" -e '
    const fs = require("node:fs");
    const src = process.argv[1];
    const dst = process.argv[2];
    let text = fs.readFileSync(src, "utf8");
    for (const [key, value] of Object.entries(process.env)) {
      text = text.split(`{{${key}}}`).join(value ?? "");
    }
    fs.writeFileSync(dst, text);
  ' "$src" "$dst"
}

install_systemd_units() {
  export NOESIS_DEPLOY_DIR NOESIS_RUN_USER NOESIS_RUN_GROUP NOESIS_HOME
  export NOESIS_RUNTIME_ENV NOESIS_BACKEND_PORT NOESIS_BACKEND_SERVICE BUN_BIN

  local backend_tmp builder_tmp
  backend_tmp="$(mktemp)"
  builder_tmp="$(mktemp)"
  render_template "$ROOT/infra/systemd/noesis-backend.no-docker.service.template" "$backend_tmp"
  render_template "$ROOT/infra/systemd/noesis-site-builder.no-docker.service.template" "$builder_tmp"

  install -m 0644 "$backend_tmp" "/etc/systemd/system/$NOESIS_BACKEND_SERVICE.service"
  install -m 0644 "$builder_tmp" "/etc/systemd/system/$NOESIS_SITE_BUILDER_SERVICE.service"
  rm -f "$backend_tmp" "$builder_tmp"

  systemctl daemon-reload
  systemctl enable "$NOESIS_BACKEND_SERVICE"
}

# Переносит уже собранную CRM из webapp/dist в релиз, если релизов ещё нет.
# Нужен ровно один раз — при первом деплое после перехода на схему
# «релиз + симлинк current». Дальше релизы делает build-webapp.sh.
seed_webapp_release() {
  local web="$ROOT/webapp/web"
  if [ -e "$web/current" ] || [ ! -s "$ROOT/webapp/dist/index.html" ]; then
    return
  fi
  local ts dest
  ts="$(date +%Y%m%d%H%M%S)-migrated"
  dest="$web/releases/$ts"
  install -d -m 0755 "$web/releases"
  cp -a "$ROOT/webapp/dist" "$dest"
  ln -sfn "releases/$ts" "$web/current"
  echo "Перенёс существующую сборку CRM в $dest и включил current."
}

install_nginx_site() {
  export NOESIS_SERVER_NAMES NOESIS_SSL_CERT NOESIS_SSL_KEY NOESIS_BACKEND_PORT
  export NOESIS_FILES_DIR NOESIS_DEPLOY_DIR

  local rendered site_available site_enabled backup had_available had_enabled
  rendered="$(mktemp)"
  site_available="/etc/nginx/sites-available/$NOESIS_NGINX_SITE"
  site_enabled="/etc/nginx/sites-enabled/$NOESIS_NGINX_SITE"
  render_template "$ROOT/infra/nginx/no-docker.conf.template" "$rendered"

  # Прежнее состояние запоминаем до установки: если nginx -t отвергнет новый
  # конфиг, невалидный файл нельзя оставлять в sites-enabled. Запущенный nginx
  # переживёт это на конфиге в памяти, но следующий reload из любого источника
  # (certbot-хук, перезагрузка) уронит весь сервер — включая соседний сайт на
  # этих же портах.
  had_available=""
  if [ -f "$site_available" ]; then had_available=1; fi
  had_enabled=""
  if [ -e "$site_enabled" ] || [ -L "$site_enabled" ]; then had_enabled=1; fi
  backup="$(mktemp)"
  if [ -n "$had_available" ]; then cp -p "$site_available" "$backup"; fi

  install -m 0644 "$rendered" "$site_available"
  rm -f "$rendered"
  ln -sfn "$site_available" "$site_enabled"

  if ! nginx -t; then
    echo "nginx -t отверг новый конфиг — возвращаем предыдущий и прерываем." >&2
    if [ -n "$had_available" ]; then
      install -m 0644 "$backup" "$site_available"
    else
      rm -f "$site_available"
    fi
    if [ -z "$had_enabled" ]; then rm -f "$site_enabled"; fi
    rm -f "$backup"
    # Проверяем, что откат вернул рабочее состояние: молча оставить сервер с
    # непроходящим nginx -t хуже, чем громко сообщить об этом сейчас.
    if ! nginx -t; then
      echo "ВНИМАНИЕ: конфигурация nginx не проходит проверку и после отката." >&2
    fi
    exit 1
  fi
  rm -f "$backup"
  systemctl reload nginx
}

wait_for_backend() {
  local url="http://127.0.0.1:$NOESIS_BACKEND_PORT/health"
  local ready=""
  for _ in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  if [ -z "$ready" ]; then
    echo "Backend did not become healthy at $url" >&2
    journalctl -u "$NOESIS_BACKEND_SERVICE" --no-pager -n 80 >&2 || true
    exit 1
  fi
}

build_frontends() {
  export BUILD_API_URL="http://127.0.0.1:$NOESIS_BACKEND_PORT"
  export PUBLIC_API_URL="${PUBLIC_API_URL:-}"
  export PUBLIC_YANDEX_MAPS_API_KEY="${PUBLIC_YANDEX_MAPS_API_KEY:-}"
  export VITE_API_URL="${VITE_API_URL:-}"
  # CRM использует тот же ключ Яндекс-карт (пикер координат конструкции).
  export VITE_YANDEX_MAPS_API_KEY="${VITE_YANDEX_MAPS_API_KEY:-${PUBLIC_YANDEX_MAPS_API_KEY:-}}"
  export SITE_URL BUILD_KEEP_RELEASES

  bash "$ROOT/infra/build-website.sh"
  bash "$ROOT/infra/build-webapp.sh"
}

notify_published() {
  if [ -z "${BUILD_WORKER_TOKEN:-}" ]; then
    return
  fi
  curl -fsS -X POST -H "X-Build-Token: $BUILD_WORKER_TOKEN" \
    "http://127.0.0.1:$NOESIS_BACKEND_PORT/api/internal/site-build/published" \
    >/dev/null 2>&1 || true
}

main() {
  require_root
  require_in_place_checkout
  require_value POSTGRES_PASSWORD
  require_value ADMIN_EMAIL
  require_value ADMIN_PASSWORD
  require_value BUILD_WORKER_TOKEN

  ensure_bun
  ensure_run_user
  ensure_postgres_db
  write_runtime_env
  load_runtime_env

  # Зависимости ставим строго по lockfile: иначе прод резолвил бы версии, которых
  # не видел ни typecheck, ни тесты, а на no-Docker хосте ещё и переписывал бы
  # закоммиченный bun.lock — рабочая копия становилась грязной, и документированный
  # `git reset --hard` начинал конфликтовать. Аварийный обход остаётся, но теперь
  # он явный.
  if [ "${ALLOW_LOCKFILE_DRIFT:-}" = "1" ]; then
    echo "ALLOW_LOCKFILE_DRIFT=1 — ставим без --frozen-lockfile." >&2
    "$BUN_BIN" install
  else
    "$BUN_BIN" install --frozen-lockfile
  fi
  "$BUN_BIN" run --cwd backend prisma:generate
  "$BUN_BIN" run --cwd backend prisma:deploy

  install_systemd_units
  systemctl restart "$NOESIS_BACKEND_SERVICE"
  wait_for_backend

  "$BUN_BIN" run --cwd backend db:seed
  # Конфиг nginx ставим ДО сборки фронтов. Сборка CRM переносит webapp/dist в
  # релиз, а прежний конфиг раздавал именно webapp/dist — между переносом и
  # перезагрузкой nginx /crm/ отдавал 404, и, если бы nginx -t отверг конфиг,
  # деплой прерывался бы с уже исчезнувшим каталогом: CRM оставалась бы лежать
  # до ручного вмешательства. В этом порядке nginx уже смотрит на
  # webapp/web/current и во время сборки продолжает отдавать ПРЕДЫДУЩИЙ релиз.
  # Разовый мост при переезде со старой схемы раздачи: конфиг уже смотрит на
  # webapp/web/current, а на сервере пока лежит только webapp/dist от прошлого
  # деплоя. Без этого /crm/ отдавал бы 404 всю сборку (Astro по всем
  # конструкциям — небыстро), а не секунды.
  seed_webapp_release
  install_nginx_site
  build_frontends
  notify_published

  systemctl enable "$NOESIS_SITE_BUILDER_SERVICE"
  systemctl restart "$NOESIS_SITE_BUILDER_SERVICE"

  echo "Noesis deployed:"
  echo "  site:    $SITE_URL"
  echo "  crm:     $SITE_URL/crm/"
  echo "  backend: http://127.0.0.1:$NOESIS_BACKEND_PORT"
}

main "$@"
