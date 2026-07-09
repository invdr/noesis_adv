#!/usr/bin/env bash
# Деплой Noesis на VPS.
# Запуск из корня репозитория: bun run deploy:vps  (или bash infra/deploy.sh)
#
# Порядок важен (Веха 4): website собирается на ХОСТЕ и фетчит реальные данные с
# backend, поэтому backend должен быть поднят, мигрирован и засеян ДО сборки
# сайта. Поэтому: (1) postgres+backend + миграции + сид; (2) сборка website/webapp
# на данных API; (3) подъём/релоуд nginx с новой статикой.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env"

echo "==> Проверка окружения"
if [ ! -f infra/.env ]; then
  echo "Нет infra/.env — скопируйте из infra/.env.example и заполните секреты." >&2
  exit 1
fi

echo "==> Установка зависимостей"
bun install --frozen-lockfile || bun install

# Предохранитель перед деплоем (Веха 6): typecheck + тесты ДО любых docker-шагов.
# Если красное — прерываемся здесь, прод остаётся на рабочей версии (контейнеры
# не пересобирались, nginx раздаёт старую статику). Полную сборку сюда не кладём:
# website собирается из живого backend ниже и уже защищён `set -e`. SKIP_CHECKS=1
# — осознанный аварийный обход (хотфикс при спотыкающихся проверках).
if [ "${SKIP_CHECKS:-}" = "1" ]; then
  echo "!! SKIP_CHECKS=1 — проверки пропущены (аварийный режим), прод без гейта."
else
  echo "==> Проверки перед деплоем (typecheck + тесты)"
  bun run --cwd backend prisma:generate   # backend typecheck требует Prisma client
  bun run typecheck
  bun run test
fi

echo "==> Поднимаем Postgres и backend (website собирается на их данных)"
$COMPOSE up -d --build postgres backend

echo "==> Ждём готовности backend (порт 127.0.0.1:3000)"
ready=""
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
if [ -z "$ready" ]; then
  echo "backend не поднялся — прерываем (старая статика сайта остаётся рабочей)." >&2
  $COMPOSE logs --tail=40 backend >&2 || true
  exit 1
fi
echo "backend готов (миграции применяются на старте контейнера)."

echo "==> Сид контента (идемпотентно: владельцы сети, конструкции, новости, категории)"
$COMPOSE exec -T backend sh -c "bun run --cwd /app/backend db:seed"

echo "==> Сборка фронтов на реальных данных API"
# SITE_URL берём из infra/.env, если задан (для перехода на домен) — без полного
# source, чтобы не зависеть от экранирования прочих секретов. `|| true` — ключа
# может не быть (напр. SITE_URL закомментирован), это не ошибка (set -e/pipefail).
get_env() { grep -E "^$1=" infra/.env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
SITE_URL_VAL="$(get_env SITE_URL)"
PUBLIC_YANDEX_MAPS_API_KEY_VAL="$(get_env PUBLIC_YANDEX_MAPS_API_KEY)"
BUILD_TOKEN_VAL="$(get_env BUILD_WORKER_TOKEN)"

# Лендинг — через общий скрипт сборки (релиз + атомарный свап current). Тот же
# flock, что у автосборщика: одновременно не больше одной сборки.
SITE_URL="${SITE_URL_VAL:-${SITE_URL:-http://168.222.140.78}}" \
PUBLIC_YANDEX_MAPS_API_KEY="${PUBLIC_YANDEX_MAPS_API_KEY_VAL:-${PUBLIC_YANDEX_MAPS_API_KEY:-}}" \
  bash infra/build-website.sh
# CRM (webapp) собирается как раньше (раздаётся nginx с ../webapp/dist).
VITE_API_URL="${VITE_API_URL:-}" bun run build:webapp

# Сообщаем backend об успешной публикации сайта (сбрасывает «нужна пересборка»
# и индикатор в CRM). Тихо пропускаем, если токен сборщика не настроен.
if [ -n "$BUILD_TOKEN_VAL" ]; then
  curl -fsS -X POST -H "X-Build-Token: $BUILD_TOKEN_VAL" \
    http://127.0.0.1:3000/api/internal/site-build/published >/dev/null 2>&1 \
    && echo "backend уведомлён о публикации сайта." \
    || echo "не удалось уведомить backend о публикации (не критично)." >&2
fi

echo "==> Поднимаем/обновляем nginx с новой статикой"
# --force-recreate обязательно: default.conf подключён как bind-mount одного
# файла. После git pull файл получает новый inode, а у работающего контейнера
# mount держит старый — без пересоздания nginx читает старый конфиг (например,
# не подхватит редиректы /constructions//news/). Статика (dist) читается с диска по
# запросу, ей пересоздание не нужно, но конфигу — нужно.
$COMPOSE up -d --build --force-recreate nginx

echo "==> Готово. Статус:"
$COMPOSE ps
