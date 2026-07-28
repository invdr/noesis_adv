#!/usr/bin/env bash
# Сборка CRM в НОВЫЙ релиз + атомарное переключение симлинка current.
#
# Зачем релиз+симлинк (то же, что в build-website.sh): nginx раздаёт стабильный
# путь webapp/web/current. Vite чистит выходной каталог перед сборкой, поэтому
# сборка прямо в раздаваемый каталог означает окно, в котором nginx отдаёт
# полупустой document root, а падение сборки после очистки оставляет CRM
# нерабочей — отката нет. Собираем в сторонке и переключаем симлинк только при
# успехе.
#
# Отдельный нюанс CRM: клиенты, у которых уже открыт старый index.html, просят
# старые хэшированные ассеты. Пока предыдущий релиз лежит рядом, они
# продолжают отдаваться — вместо 404, который try_files превращает в index.html
# и браузер получает HTML там, где ждал JS.
#
# Сериализация: тот же flock, что у сборки сайта — одновременно не больше одной
# сборки.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCK="$ROOT/infra/.site-build.lock"
WEB="$ROOT/webapp/web"
RELEASES="$WEB/releases"
KEEP="${BUILD_KEEP_RELEASES:-5}"

exec 200>"$LOCK"
flock -w 900 200 || { echo "build-webapp: не удалось взять блокировку" >&2; exit 1; }

mkdir -p "$RELEASES"
ts="$(date +%Y%m%d%H%M%S)"
dest="$RELEASES/$ts"

bun run build:webapp

# Санити: не публикуем пустую сборку. index.html — единственная точка входа SPA,
# а assets/ должен содержать хотя бы один бандл.
DIST="$ROOT/webapp/dist"
if [ ! -s "$DIST/index.html" ]; then
  echo "build-webapp: пустой или отсутствующий index.html — не публикуем." >&2
  exit 1
fi
if [ -z "$(ls -A "$DIST/assets" 2>/dev/null)" ]; then
  echo "build-webapp: в сборке нет ассетов — не публикуем." >&2
  exit 1
fi

# Кладём свежий dist в релиз и атомарно переключаем current.
rm -rf "$dest"
mv "$DIST" "$dest"
ln -sfn "releases/$ts" "$WEB/current"

# Прунинг: оставляем последние $KEEP релизов (текущий не трогаем). Старые
# релизы нужны не только ради отката — из них догружаются ассеты у клиентов,
# не успевших перезагрузить страницу.
current_target="$(readlink -f "$WEB/current" || true)"
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$(readlink -f "$old")" = "$current_target" ] && continue
  rm -rf "$old"
done

echo "build-webapp: опубликован релиз $ts"
