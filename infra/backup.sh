#!/usr/bin/env bash
# Резервная копия прода Noesis (VPS): дамп PostgreSQL + архив загруженных
# файлов. Рассчитан на действующий прод — no-Docker (host nginx + host
# PostgreSQL + systemd), тот же стек, который разворачивает
# infra/deploy-no-docker.sh. Запуск из корня репозитория, от root:
#   bash infra/backup.sh            # вручную
#   (по расписанию — cron, см. docs/backup-restore.md)
#
# Настройки берутся из infra/no-docker.env (как в deploy-no-docker.sh):
# POSTGRES_DB / POSTGRES_USER — база, NOESIS_FILES_DIR — каталог загрузок.
#
# Куда: $BACKUP_DIR/<YYYY-MM-DD_HHMM>/{db.sql.gz, files.tar.gz}.
# Ротация: каталоги старше $BACKUP_KEEP_DAYS дней удаляются.
# Офсайт: если в no-docker.env заданы TELEGRAM_BOT_TOKEN,
# BACKUP_TELEGRAM_CHAT_ID и BACKUP_PASSPHRASE, дамп БД (обычно небольшой)
# дополнительно отправляется документом в Telegram — копия переживает отказ
# диска VPS. Дамп содержит ПДн (заявки, согласия) и хэши паролей, поэтому
# наружу уходит только зашифрованным (gpg, симметрично парольной фразой); без
# BACKUP_PASSPHRASE отправка пропускается. Архив файлов в Telegram не шлём
# (лимит бота 50 МБ); полноценный офсайт файлов — rclone/S3, см. runbook.
#
# Восстановление — docs/backup-restore.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${NOESIS_ENV_FILE:-$ROOT/infra/no-docker.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Нет $ENV_FILE — бэкап снимается с прод-стека и требует его настроек." >&2
  echo "Скопируйте infra/no-docker.env.example и заполните секреты." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

PG_DB="${POSTGRES_DB:-noesis}"
FILES_DIR="${NOESIS_FILES_DIR:-/var/lib/noesis/files}"

BACKUP_DIR="${BACKUP_DIR:-/root/noesis-backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
DEST="$BACKUP_DIR/$STAMP"

# Дамп снимаем системным пользователем postgres (peer-аутентификация), чтобы
# пароль роли не попадал ни в argv, ни в окружение. Тот же приём, что в
# deploy-no-docker.sh.
as_postgres() {
  if command -v sudo >/dev/null 2>&1; then
    sudo -u postgres "$@"
  else
    runuser -u postgres -- "$@"
  fi
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Запускайте от root: нужен доступ к пользователю postgres и к $FILES_DIR." >&2
  exit 1
fi

if [ ! -d "$FILES_DIR" ]; then
  echo "Каталог загруженных файлов не найден: $FILES_DIR" >&2
  echo "Проверьте NOESIS_FILES_DIR в $ENV_FILE." >&2
  exit 1
fi

# Гранулярность метки — минута: при повторном запуске в ту же минуту mv ниже
# вложил бы новый каталог внутрь существующего вместо замены.
if [ -e "$DEST" ]; then
  echo "Бэкап за минуту $STAMP уже есть ($DEST) — повторите позже." >&2
  exit 1
fi

# Пишем во временный каталог и переименовываем в самом конце: каталог с датой
# появляется только после успешного снятия обеих копий. Упавший на середине
# запуск (оборванный дамп, сбой tar) не оставит частичный бэкап, который в
# день аварии можно принять за валидный. Хвост .tmp подчищается на выходе.
DEST_TMP="$DEST.tmp"
mkdir -p "$DEST_TMP"
trap 'rm -rf "$DEST_TMP"' EXIT

echo "==> Дамп БД ($PG_DB) в $DEST/db.sql.gz"
# --clean --if-exists: дамп сам чистит объекты при восстановлении в непустую базу.
# Владельцем объектов остаётся роль приложения, поэтому дамп снимаем с -O не
# указывая: восстановление идёт от той же роли (см. runbook).
as_postgres pg_dump -d "$PG_DB" --clean --if-exists \
  | gzip > "$DEST_TMP/db.sql.gz"
# Оборванный/битый дамп не считаем успехом: pg_dump всегда завершает валидный
# дамп маркером. tail читает поток целиком, так что gunzip не получит SIGPIPE.
gunzip -c "$DEST_TMP/db.sql.gz" | tail -n 5 | grep -q "PostgreSQL database dump complete" \
  || { echo "В дампе БД нет финального маркера pg_dump — прерываем." >&2; exit 1; }

echo "==> Архив загруженных файлов ($FILES_DIR) в $DEST/files.tar.gz"
# Бэкап снимается с живого сервера: загрузка или удаление файла ровно во время
# чтения даёт у tar предупреждение и код возврата 1. Под `set -e` это обрывало
# бы весь скрипт, а trap удалял бы каталог — из-за одной параллельной загрузки
# в 03:00 не осталось бы НИКАКОЙ копии за ночь. Предупреждения глушим и терпим
# код 1; код 2 (настоящая ошибка) по-прежнему прерывает. Целостность архива
# всё равно проверяется ниже.
tar_status=0
tar --warning=no-file-changed --warning=no-file-removed \
  -C "$FILES_DIR" -czf "$DEST_TMP/files.tar.gz" . || tar_status=$?
if [ "$tar_status" -gt 1 ]; then
  echo "tar завершился с кодом $tar_status — прерываем." >&2
  exit 1
fi
if [ "$tar_status" -eq 1 ]; then
  echo "tar: часть файлов изменилась во время архивации (параллельная загрузка) — архив снят." >&2
fi
# Проверяем не только целостность gzip, но и структуру tar внутри.
tar -tzf "$DEST_TMP/files.tar.gz" >/dev/null

# Обе копии сняты и проверены — публикуем каталог атомарно.
mv "$DEST_TMP" "$DEST"

echo "==> Ротация: удаляем бэкапы старше $BACKUP_KEEP_DAYS дней"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$BACKUP_KEEP_DAYS" \
  -exec rm -rf {} +

# Офсайт-копия дампа БД в Telegram (опционально; лимит документа бота — 50 МБ).
# Дамп содержит ПДн и хэши паролей, поэтому в Telegram уходит только
# зашифрованным (gpg AES256, парольная фраза BACKUP_PASSPHRASE из no-docker.env).
TG_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TG_CHAT="${BACKUP_TELEGRAM_CHAT_ID:-}"
BK_PASS="${BACKUP_PASSPHRASE:-}"
if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
  if [ -z "$BK_PASS" ]; then
    echo "BACKUP_PASSPHRASE не задан — дамп с ПДн в открытом виде в Telegram не шлём." >&2
  elif ! command -v gpg >/dev/null 2>&1; then
    echo "gpg не установлен (apt install gnupg) — офсайт-копию пропускаем." >&2
  # Парольная фраза через fd 3, а не argv — не светится в ps. Сбой gpg не
  # роняет скрипт: локальный бэкап к этому моменту уже снят и проверен,
  # офсайт-копия — best effort (как отправка ниже).
  elif ! gpg --batch --yes --symmetric --cipher-algo AES256 --pinentry-mode loopback \
      --passphrase-fd 3 -o "$DEST/db.sql.gz.gpg" "$DEST/db.sql.gz" 3<<<"$BK_PASS"; then
    echo "gpg не смог зашифровать дамп — офсайт-копию пропускаем (локальная есть)." >&2
  else
    size=$(stat -c%s "$DEST/db.sql.gz.gpg")
    if [ "$size" -lt $((45 * 1024 * 1024)) ]; then
      echo "==> Отправка зашифрованного дампа БД в Telegram (офсайт-копия)"
      # URL с токеном бота — через конфиг на fd 3, а не argv (не светится в ps).
      curl -fsS -X POST \
        -F "chat_id=$TG_CHAT" \
        -F "document=@$DEST/db.sql.gz.gpg;filename=noesis-db-$STAMP.sql.gz.gpg" \
        -F "caption=Бэкап БД Noesis $STAMP (расшифровка: gpg -d, парольная фраза в infra/no-docker.env)" \
        --config /dev/fd/3 >/dev/null \
        3<<<"url = \"https://api.telegram.org/bot$TG_TOKEN/sendDocument\"" \
        && echo "дамп отправлен в Telegram." \
        || echo "не удалось отправить дамп в Telegram (не критично, локальная копия есть)." >&2
    else
      echo "дамп БД больше 45 МБ — в Telegram не шлём (настройте rclone/S3)." >&2
    fi
  fi
fi

echo "==> Готово:"
ls -lh "$DEST"
