# Бэкапы и восстановление прода

Прод — один VPS, отката деплоя нет (roll-forward). Единственная защита
данных (заявки, сделки, записи согласий ПДн, загруженные файлы) — резервные
копии. Этот документ — что бэкапим, как включить расписание и **отрепетированная**
процедура восстановления на чистом сервере.

## Что бэкапим

| Что | Откуда | Куда |
| --- | --- | --- |
| БД PostgreSQL (`pg_dump --clean --if-exists`, gzip) | контейнер `postgres` | `/root/noesis-backups/<дата>/db.sql.gz` |
| Загруженные файлы (фото ЖК, документы, ход строительства) | том `files_data` через контейнер `backend` | `/root/noesis-backups/<дата>/files.tar.gz` |

Не бэкапим: статику сайта/CRM (пересобирается из репозитория), сам репозиторий
(живёт на GitHub). **Но `infra/.env` в репо нет** — храните его копию в надёжном
месте (менеджер паролей): без секретов восстановление начнётся с пересоздания
всех паролей и токенов.

## Запуск

```bash
cd /root/noesis_adv
bash infra/backup.sh          # разовая копия
```

Расписание — cron на хосте (ежедневно в 03:00 МСК):

```bash
crontab -e
# добавить строку:
0 3 * * * cd /root/noesis_adv && bash infra/backup.sh >> /var/log/tower-backup.log 2>&1
```

Ротация встроена: каталоги старше `BACKUP_KEEP_DAYS` (по умолчанию 14) дней
удаляются при каждом запуске.

## Офсайт-копия (переживает отказ диска VPS)

Локальный каталог `/root/noesis-backups` не спасает при потере самого VPS.
Минимальный офсайт уже встроен: если в `infra/.env` заданы

```
TELEGRAM_BOT_TOKEN=...            # уже есть (уведомления о заявках)
BACKUP_TELEGRAM_CHAT_ID=...       # приватный чат/канал для бэкапов
BACKUP_PASSPHRASE=...             # парольная фраза шифрования офсайт-копии
```

— каждый запуск дополнительно отправляет дамп документом в Telegram (лимит
бота 50 МБ; текущий дамп ~15 КБ, запас огромный). Дамп содержит ПДн (заявки,
согласия) и хэши паролей, поэтому наружу уходит **только зашифрованным**:
`db.sql.gz.gpg` (gpg, AES256, симметрично `BACKUP_PASSPHRASE`); без парольной
фразы отправка пропускается с предупреждением в лог. Храните копию фразы вне
VPS (менеджер паролей) — без неё офсайт-копию не расшифровать. Расшифровка:

```bash
gpg -d noesis-db-<дата>.sql.gz.gpg > db.sql.gz   # спросит парольную фразу
```

Архив файлов в Telegram не шлём — для полного офсайта файлов настройте rclone
на S3-совместимое хранилище (при наличии у провайдера) и добавьте в cron:

```bash
rclone sync /root/noesis-backups remote:noesis-backups
```

## Восстановление

Отрепетировано (июль 2026) для БД: дамп → чистая база → 0 ошибок, количество
строк по всем таблицам совпало. Команды файловой ветки (шаг 4) проверены на
тестовом архиве вне прод-стека; при первой возможности прогоните шаги 3–4 на
VPS целиком и обновите эту пометку.

### Случай А: испортили данные, сервер жив

```bash
cd /root/noesis_adv
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env"
# Ошибка в любом звене пайпа = ошибка команды, а не молчаливый «успех».
set -o pipefail
# Креды БД — из infra/.env, как их видит сам стек (не хардкодим).
PG_USER=$(grep -E '^POSTGRES_USER=' infra/.env | cut -d= -f2-); PG_USER=${PG_USER:-gsk}
PG_DB=$(grep -E '^POSTGRES_DB=' infra/.env | cut -d= -f2-); PG_DB=${PG_DB:-noesis}

# 1) Остановить backend, чтобы никто не писал в БД во время восстановления.
$COMPOSE stop backend

# 2) Пересоздать базу пустой и залить дамп.
#    Восстанавливаем в пустую базу, а не поверх: --clean внутри дампа чистит
#    только объекты своей ревизии и без CASCADE — если схема успела уехать
#    вперёд (после снятия копии катились миграции), DROP старой таблицы
#    упадёт на зависимостях. ON_ERROR_STOP: без него psql продолжает после
#    ошибок и возвращает 0 — частично применённый дамп сойдёт за успех.
$COMPOSE exec -T postgres dropdb -U "$PG_USER" "$PG_DB"
$COMPOSE exec -T postgres createdb -U "$PG_USER" "$PG_DB"
gunzip -c /root/noesis-backups/<дата>/db.sql.gz \
  | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB"

# 3) Поднять backend обратно: exec следующего шага требует живой контейнер
#    (том files_data смонтирован именно в него).
$COMPOSE up -d backend

# 4) Файлы (если нужно): очистить том и распаковать архив.
#    Осторожно: сносит текущие файлы. rm с глобом не подходит — глоб раскрыл бы
#    хостовый shell, а не контейнер; find выполняется целиком внутри.
$COMPOSE exec -T backend find /srv/files -mindepth 1 -delete
$COMPOSE exec -T backend tar -C /srv/files -xzf - \
  < /root/noesis-backups/<дата>/files.tar.gz
# (гибче: восстановить во временный каталог и разложить вручную)

# 5) Пересобрать сайт на восстановленных данных.
bun run deploy:vps
```

### Случай Б: VPS потерян, поднимаем с нуля

1. Новый VPS: установить Docker + Docker Compose и Bun
   (`curl -fsSL https://bun.sh/install | bash`).
2. `git clone <репозиторий> /root/noesis_adv && cd /root/noesis_adv`.
3. Восстановить `infra/.env` из надёжного места (или пересоздать по
   `infra/.env.example` — тогда все секреты новые).
4. Поднять только Postgres и залить дамп **до** первого старта backend
   (иначе миграции создадут пустую схему поверх — не страшно, дамп её
   перезапишет, но чище так):

   ```bash
   COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file infra/.env"
   set -o pipefail
   PG_USER=$(grep -E '^POSTGRES_USER=' infra/.env | cut -d= -f2-); PG_USER=${PG_USER:-gsk}
   PG_DB=$(grep -E '^POSTGRES_DB=' infra/.env | cut -d= -f2-); PG_DB=${PG_DB:-noesis}
   $COMPOSE up -d postgres
   # дождаться healthy: $COMPOSE ps
   gunzip -c db.sql.gz \
     | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB"
   ```

5. `bun run deploy:vps` — поднимет backend (миграции на старте увидят
   актуальную схему и пропустятся), соберёт сайт/CRM, пересоздаст nginx.
6. Восстановить файлы в том — backend уже поднят, см. Случай А, шаг 4.
7. Проверить: вход в CRM, список заявок, страницы ЖК, загруженные фото.
8. Вернуть cron с бэкапом (см. выше) — на новом сервере его нет.

### Пометки

- Дамп содержит и историю миграций Prisma (`_prisma_migrations`), поэтому
  backend после восстановления не накатывает уже применённые миграции заново.
  Если дамп старее текущего кода (после снятия копии катились новые миграции) —
  недостающие миграции применятся при старте backend, это штатно.
- Пользователи/сессии тоже в дампе: все пароли и логины работают как на момент
  копии; активные сессии протухнут по TTL — это нормально.
- Проверяйте бэкап хотя бы раз в квартал: `gunzip -t db.sql.gz` (целостность) и
  тестовое восстановление в отдельную базу (`$COMPOSE`, `$PG_USER` — как в
  Случае А):

  ```bash
  $COMPOSE exec -T postgres createdb -U "$PG_USER" noesis_check
  gunzip -c db.sql.gz \
    | $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d noesis_check
  $COMPOSE exec -T postgres dropdb -U "$PG_USER" noesis_check
  ```
