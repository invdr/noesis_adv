#!/usr/bin/env bash
# Сборка лендинга в НОВЫЙ релиз + атомарное переключение симлинка current.
# Используется и ручным деплоем (deploy.sh), и автосборщиком (site-builder.sh).
#
# Зачем релиз+симлинк: nginx раздаёт стабильный путь website/web/current.
# Сборка идёт в сторонке (website/web/releases/<ts>), и только при УСПЕХЕ
# симлинк атомарно (rename) переключается на новый релиз. Если сборка упала —
# current не трогаем, сайт остаётся на последней рабочей версии (Веха 4.2).
#
# Сериализация: общий flock с deploy.sh — одновременно не больше одной сборки.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCK="$ROOT/infra/.site-build.lock"
WEB="$ROOT/website/web"
RELEASES="$WEB/releases"
KEEP="${BUILD_KEEP_RELEASES:-5}"

# Берём блокировку (ждём до 15 мин, если идёт другая сборка/деплой).
exec 200>"$LOCK"
flock -w 900 200 || { echo "build-website: не удалось взять блокировку" >&2; exit 1; }

mkdir -p "$RELEASES"
ts="$(date +%Y%m%d%H%M%S)"
dest="$RELEASES/$ts"

# Сборка website на данных API. BUILD_API_URL — серверный фетч на сборке;
# PUBLIC_API_URL пустой → браузер ходит на относительный /api; SITE_URL —
# рабочий origin для canonical/OG/sitemap (при появлении домена задаётся в .env).
BUILD_API_URL="${BUILD_API_URL:-http://127.0.0.1:3000}" \
PUBLIC_API_URL="${PUBLIC_API_URL:-}" \
SITE_URL="${SITE_URL:-http://168.222.140.78}" \
  bun run build:website

# Санити контента (Веха 6): не публикуем заведомо пустой сайт. Каталог ЖК на
# главной рендерится client-side, поэтому проверяем артефакты сборки от тех же
# данных API — в sitemap должен быть хотя бы один ЖК (/zhk/). «0 ЖК» для сайта
# недвижимости трактуем как ошибку (бэк отдал пусто). При провале НЕ переключаем
# current — сайт остаётся на рабочей версии. SKIP_CHECKS=1 — аварийный обход.
DIST="$ROOT/website/dist"
if [ "${SKIP_CHECKS:-}" = "1" ]; then
  echo "build-website: SKIP_CHECKS=1 — санити контента пропущена."
else
  if [ ! -s "$DIST/index.html" ]; then
    echo "build-website: пустой или отсутствующий index.html — не публикуем." >&2
    exit 1
  fi
  zhk_count="$(grep -c "/zhk/" "$DIST/sitemap.xml" 2>/dev/null || true)"
  if [ -z "$zhk_count" ] || [ "$zhk_count" -lt 1 ]; then
    echo "build-website: в sitemap нет ни одного ЖК (/zhk/) — похоже, API отдал пусто. Не публикуем." >&2
    exit 1
  fi
  echo "build-website: санити ок (ЖК в sitemap: $zhk_count)."
fi

# Кладём свежий dist в релиз и атомарно переключаем current.
rm -rf "$dest"
mv "$ROOT/website/dist" "$dest"
ln -sfn "releases/$ts" "$WEB/current"

# Прунинг: оставляем последние $KEEP релизов (текущий не трогаем).
current_target="$(readlink -f "$WEB/current" || true)"
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$(readlink -f "$old")" = "$current_target" ] && continue
  rm -rf "$old"
done

echo "build-website: опубликован релиз $ts"
