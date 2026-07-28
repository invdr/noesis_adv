# Бэкапы и восстановление прода

Прод — один VPS, отката деплоя нет (roll-forward). Единственная защита
данных (заявки, сделки, записи согласий ПДн, загруженные файлы) — резервные
копии. Этот документ — что бэкапим, как включить расписание и процедура
восстановления на чистом сервере.

Всё ниже — про **действующий прод: no-Docker** (host nginx + host PostgreSQL +
systemd, `/var/www/noesis_adv`), тот же стек, который разворачивает
`infra/deploy-no-docker.sh`. Docker на сервере не установлен; если когда-нибудь
вернётесь на `docker-compose.prod.yml`, процедуру придётся переписать.

## Что бэкапим

| Что | Откуда | Куда |
| --- | --- | --- |
| БД PostgreSQL (`pg_dump --clean --if-exists`, gzip) | host PostgreSQL, база `POSTGRES_DB` | `/root/noesis-backups/<дата>/db.sql.gz` |
| Загруженные файлы (фото конструкций, документы, фотоотчёты) | каталог `NOESIS_FILES_DIR` (по умолчанию `/var/lib/noesis/files`) | `/root/noesis-backups/<дата>/files.tar.gz` |

Не бэкапим: статику сайта/CRM (пересобирается из репозитория), сам репозиторий
(живёт на GitHub). **Но `infra/no-docker.env` в репо нет** — храните его копию в
надёжном месте (менеджер паролей): без секретов восстановление начнётся с
пересоздания всех паролей и токенов.

## Запуск

```bash
cd /var/www/noesis_adv
bash infra/backup.sh          # разовая копия, от root
```

Скрипт читает `infra/no-docker.env` (базу, пользователя и `NOESIS_FILES_DIR`),
снимает дамп системным пользователем `postgres` (peer-аутентификация — пароль
роли нигде не светится) и архивирует каталог файлов напрямую.

Расписание — cron на хосте (ежедневно в 03:00 МСК):

```bash
crontab -e
# добавить строку:
0 3 * * * cd /var/www/noesis_adv && bash infra/backup.sh >> /var/log/noesis-backup.log 2>&1
```

Ротация встроена: каталоги старше `BACKUP_KEEP_DAYS` (по умолчанию 14) дней
удаляются при каждом запуске.

## Офсайт-копия (переживает отказ диска VPS)

Локальный каталог `/root/noesis-backups` не спасает при потере самого VPS.
Минимальный офсайт уже встроен: если в `infra/no-docker.env` заданы

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

Процедура ниже переписана под no-Docker и **на прод-стеке ещё не
отрепетирована** — прогоните её на тестовой базе при первой возможности и
обновите эту пометку. Ранее репетиция (июль 2026) проводилась на Docker-стеке,
которого на сервере больше нет.

Во всех блоках креды и каталоги берутся из `infra/no-docker.env`, а обращение к
базе идёт от системного пользователя `postgres`, как в `backup.sh` и
`deploy-no-docker.sh`.

### Случай А: испортили данные, сервер жив

```bash
cd /var/www/noesis_adv
# Ошибка в любом звене пайпа = ошибка команды, а не молчаливый «успех».
set -o pipefail
# Настройки — из no-docker.env, как их видит сам стек (не хардкодим).
set -a; . infra/no-docker.env; set +a
PG_DB="${POSTGRES_DB:-noesis}"
PG_USER="${POSTGRES_USER:-noesis}"
FILES_DIR="${NOESIS_FILES_DIR:-/var/lib/noesis/files}"

# 1) Остановить backend, чтобы никто не писал в БД во время восстановления.
systemctl stop noesis-backend

# 2) Пересоздать базу пустой и залить дамп.
#    Восстанавливаем в пустую базу, а не поверх: --clean внутри дампа чистит
#    только объекты своей ревизии и без CASCADE — если схема успела уехать
#    вперёд (после снятия копии катились миграции), DROP старой таблицы
#    упадёт на зависимостях. ON_ERROR_STOP: без него psql продолжает после
#    ошибок и возвращает 0 — частично применённый дамп сойдёт за успех.
sudo -u postgres dropdb "$PG_DB"
sudo -u postgres createdb -O "$PG_USER" "$PG_DB"
gunzip -c /root/noesis-backups/<дата>/db.sql.gz \
  | sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$PG_DB"

# 3) Файлы (если нужно): очистить каталог и распаковать архив.
#    Осторожно: сносит текущие файлы.
find "$FILES_DIR" -mindepth 1 -delete
tar -C "$FILES_DIR" -xzf /root/noesis-backups/<дата>/files.tar.gz
chown -R noesis:noesis "$FILES_DIR"
# (гибче: восстановить во временный каталог и разложить вручную)

# 4) Поднять backend обратно.
systemctl start noesis-backend

# 5) Пересобрать сайт на восстановленных данных.
bash infra/deploy-no-docker.sh
```

### Случай Б: VPS потерян, поднимаем с нуля

1. Новый VPS: nginx, PostgreSQL 18 и Bun
   (`curl -fsSL https://bun.sh/install | bash`). Первичная настройка — см.
   [DEPLOYMENT_VPS.md](./DEPLOYMENT_VPS.md).
2. `git clone <репозиторий> /var/www/noesis_adv && cd /var/www/noesis_adv`.
3. Восстановить `infra/no-docker.env` из надёжного места (или пересоздать по
   `infra/no-docker.env.example` — тогда все секреты новые).
4. Прогнать деплой один раз: он создаст роль, базу, systemd-юниты и накатит
   миграции.

   ```bash
   bash infra/deploy-no-docker.sh
   ```

5. Залить дамп поверх созданной схемы (backend на время заливки остановить):

   ```bash
   set -o pipefail
   set -a; . infra/no-docker.env; set +a
   PG_DB="${POSTGRES_DB:-noesis}"
   PG_USER="${POSTGRES_USER:-noesis}"
   systemctl stop noesis-backend
   sudo -u postgres dropdb "$PG_DB"
   sudo -u postgres createdb -O "$PG_USER" "$PG_DB"
   gunzip -c db.sql.gz \
     | sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$PG_DB"
   systemctl start noesis-backend
   ```

6. Восстановить файлы — см. Случай А, шаг 3.
7. Пересобрать сайт: `bash infra/deploy-no-docker.sh`.
8. Проверить: вход в CRM, список заявок, страницы конструкций, загруженные фото.
9. Вернуть cron с бэкапом (см. выше) — на новом сервере его нет.

### Пометки

- Дамп содержит и историю миграций Prisma (`_prisma_migrations`), поэтому
  backend после восстановления не накатывает уже применённые миграции заново.
  Если дамп старее текущего кода (после снятия копии катились новые миграции) —
  недостающие миграции применятся при старте backend, это штатно.
- Пользователи/сессии тоже в дампе: все пароли и логины работают как на момент
  копии; активные сессии протухнут по TTL — это нормально.
- Проверяйте бэкап хотя бы раз в квартал: `gunzip -t db.sql.gz` (целостность) и
  тестовое восстановление в отдельную базу:

  ```bash
  set -o pipefail
  set -a; . infra/no-docker.env; set +a
  PG_USER="${POSTGRES_USER:-noesis}"
  sudo -u postgres createdb -O "$PG_USER" noesis_check
  gunzip -c db.sql.gz \
    | sudo -u postgres psql -v ON_ERROR_STOP=1 -d noesis_check
  sudo -u postgres dropdb noesis_check
  ```
