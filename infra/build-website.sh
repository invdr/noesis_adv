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
# Лог сборки сохраняем: гейт ниже ищет в нём маркер отката настроек сайта.
BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
set -o pipefail
BUILD_API_URL="${BUILD_API_URL:-http://127.0.0.1:3000}" \
PUBLIC_API_URL="${PUBLIC_API_URL:-}" \
SITE_URL="${SITE_URL:-https://noesis.catlg.ru}" \
  bun run build:website 2>&1 | tee "$BUILD_LOG"

# Санити контента (Веха 6): не публикуем заведомо пустой сайт. Каталог конструкций на
# главной рендерится client-side, поэтому проверяем артефакты сборки от тех же
# данных API — в sitemap должна быть хотя бы одна конструкция (/constructions/).
# «0 конструкций» трактуем как ошибку (бэк отдал пусто). При провале НЕ переключаем
# current — сайт остаётся на рабочей версии. SKIP_CHECKS=1 — аварийный обход.
DIST="$ROOT/website/dist"
if [ "${SKIP_CHECKS:-}" = "1" ]; then
  echo "build-website: SKIP_CHECKS=1 — санити контента пропущена."
else
  if [ ! -s "$DIST/index.html" ]; then
    echo "build-website: пустой или отсутствующий index.html — не публикуем." >&2
    exit 1
  fi
  construction_count="$(grep -c "/constructions/" "$DIST/sitemap.xml" 2>/dev/null || true)"
  if [ -z "$construction_count" ] || [ "$construction_count" -lt 1 ]; then
    echo "build-website: в sitemap нет ни одной конструкции (/constructions/) — похоже, API отдал пусто. Не публикуем." >&2
    exit 1
  fi
  # Настройки сайта (телефон, почта, счётчик Метрики) приходят из CRM, а их
  # недоступность сознательно не роняет сборку. Но публиковать такой сайт
  # нельзя: наружу уйдут зашитые контакты и пропадёт Метрика, а по виду
  # страницы это неотличимо от нормы.
  if grep -qF "[site-settings] ОТКАТ НА ДЕФОЛТЫ" "$BUILD_LOG"; then
    echo "build-website: настройки сайта не получены из CRM — на страницах были бы дефолтные контакты. Не публикуем." >&2
    exit 1
  fi

  # Индексация: robots.txt закрывает сайт целиком, когда SITE_URL не резолвится
  # в настоящий домен (голый IP или пусто). Это ровно тот отказ, который никак
  # не виден глазами — публикуем де-индексированный сайт и узнаём об этом из
  # падения трафика. Гейт ловит его до переключения current.
  if grep -q "^Disallow: /$" "$DIST/robots.txt" 2>/dev/null; then
    echo "build-website: robots.txt закрывает индексацию — проверьте SITE_URL (сейчас «${SITE_URL:-не задан}»). Не публикуем." >&2
    exit 1
  fi
  echo "build-website: санити ок (конструкций в sitemap: $construction_count)."
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
