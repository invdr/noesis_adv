#!/usr/bin/env bash
# Сервис-сборщик лендинга на хосте (Веха 4.2). Опрашивает backend: «нужна ли
# пересборка?» (с учётом дебаунса и сериализации — логика в backend), и при
# необходимости собирает сайт (build-website.sh) и отчитывается о результате.
#
# Запускается как systemd-сервис gsk-site-builder (Restart=always), токен и
# параметры — из infra/.env (EnvironmentFile). Бесконечный цикл с паузой.
#
# JSON разбираем/кодируем через bun (на VPS он всегда есть) — надёжнее, чем
# grep/sed, и безопасно экранирует текст ошибки.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="${BUILD_API_URL:-http://127.0.0.1:3000}"
INTERVAL="${BUILD_POLL_SECONDS:-30}"
TOKEN="${BUILD_WORKER_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "site-builder: BUILD_WORKER_TOKEN не задан в infra/.env — выходим" >&2
  exit 1
fi

echo "site-builder: старт (API=$API, интервал=${INTERVAL}с)"

while true; do
  resp="$(curl -fsS -H "X-Build-Token: $TOKEN" "$API/api/internal/site-build/claim" 2>/dev/null || echo '')"
  if [ -n "$resp" ]; then
    # "<build:1|0> <buildId>"
    parsed="$(printf '%s' "$resp" | bun -e 'const j=JSON.parse((await Bun.stdin.text())||"{}"); process.stdout.write(`${j.build?1:0} ${j.buildId??""}`)' 2>/dev/null || echo "0 ")"
    build="${parsed%% *}"
    buildId="${parsed#* }"

    if [ "$build" = "1" ] && [ -n "$buildId" ]; then
      echo "site-builder: собираю релиз (buildId=$buildId)"
      log="$(mktemp)"
      if bash "$ROOT/infra/build-website.sh" >"$log" 2>&1; then
        ok="true"; err=""
      else
        ok="false"; err="$(tail -c 1500 "$log")"
        echo "site-builder: сборка упала" >&2
      fi
      payload="$(BID="$buildId" OK="$ok" ERR="$err" bun -e 'console.log(JSON.stringify({buildId:process.env.BID,ok:process.env.OK==="true",error:process.env.ERR||undefined}))')"
      curl -fsS -X POST -H "X-Build-Token: $TOKEN" -H "Content-Type: application/json" \
        -d "$payload" "$API/api/internal/site-build/result" >/dev/null 2>&1 \
        || echo "site-builder: не удалось отправить результат" >&2
      rm -f "$log"
      continue   # сразу опросить снова (вдруг накопились догоняющие правки)
    fi
  fi
  sleep "$INTERVAL"
done
