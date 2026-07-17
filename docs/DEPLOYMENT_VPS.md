# Деплой на VPS

Прод-инфраструктура — один VPS на VPS с Docker. Всё поднимается через
`infra/docker-compose.prod.yml`: PostgreSQL, бэкенд (Hono+Prisma) и nginx,
который раздаёт статику и проксирует API.

```
Интернет ──▶ nginx (80/443)
                ├── /            → /srv/website  (Astro static, лендинг)
                ├── /crm/        → /srv/webapp   (React SPA, мини-CRM)
                └── /api/        → backend:3000  (Hono API)
backend ──▶ postgres:5432
```

## Вариант без Docker рядом с существующим сайтом

Если VPS уже обслуживает другой проект через host-nginx и host-PostgreSQL
(как `catlg.ru` на текущем сервере), Docker Compose из коробки применять нельзя:
он хочет занять `80/443` своим nginx и `127.0.0.1:3000` backend-портом.
Для такого сценария есть отдельный no-Docker путь:

```
Интернет ──▶ host nginx (80/443)
                ├── catlg.ru             → существующий Next.js :3000
                └── noesis.catlg.ru      → Noesis
                        ├── /            → website/web/current
                        ├── /crm/        → webapp/dist
                        ├── /files/      → /var/lib/noesis/files
                        └── /api/        → 127.0.0.1:3001
Noesis backend ──▶ host PostgreSQL:5432, отдельная БД/роль
```

Файлы этого режима:

- `infra/no-docker.env.example` — пример окружения для конкретного VPS.
- `infra/deploy-no-docker.sh` — idempotent-деплой без Docker.
- `infra/nginx/no-docker.conf.template` — server block для host-nginx.
- `infra/systemd/*.no-docker.service.template` — backend и site-builder.

Первый запуск на VPS:

```bash
cd /var/www/noesis_adv
cp infra/no-docker.env.example infra/no-docker.env
# заполнить POSTGRES_PASSWORD, ADMIN_PASSWORD, BUILD_WORKER_TOKEN
sudo bash infra/deploy-no-docker.sh  # нужен root; первый запуск сам установит bun
# последующие запуски также: sudo bash infra/deploy-no-docker.sh
```

Что делает скрипт:

- устанавливает/публикует `bun` в `/usr/local/bin/bun`, если его нет;
- создаёт системного пользователя `noesis` и каталог файлов
  `/var/lib/noesis/files`;
- создаёт отдельную роль/БД PostgreSQL;
- пишет runtime-env в `/etc/noesis/backend.env`;
- ставит systemd-сервисы `noesis-backend` и `noesis-site-builder`;
- запускает backend на `127.0.0.1:3001`, применяет Prisma migrations и сид;
- собирает website/webapp и подключает nginx-site `noesis`;
- не трогает существующий `catalog-noema.service` и его порт `3000`.

Для текущего VPS дефолтный домен — `noesis.catlg.ru`: точный `server_name`
выигрывает у существующего wildcard `*.catlg.ru`, а TLS использует уже выпущенный
wildcard-сертификат `catlg.ru-0001`. Если используется другой домен, поменяйте
`NOESIS_DOMAIN`, `NOESIS_SERVER_NAMES`, `SITE_URL`, `CORS_ORIGINS`,
`NOESIS_SSL_CERT` и `NOESIS_SSL_KEY` в `infra/no-docker.env`.

## Деплой по IP без домена (HTTP)

Пока домена нет, сайт открывается по голому IP — `http://<VPS_IP>/`
(CRM — `http://<VPS_IP>/crm/`). Для этого режима в `infra/.env.example`
уже выставлены безопасные для HTTP значения, важно их не перепутать:

- `CORS_ORIGINS=http://<VPS_IP>` — ровно тот origin, по которому
  открывают сайт (схема + IP, без слэша и без порта). Если оставить здесь
  домен или `https`, анти-CSRF guard вернёт **403** на входе в CRM и на
  отправке заявки с лендинга.
- `COOKIE_SECURE=false` — по HTTP браузер не сохраняет cookie с флагом
  `Secure`, поэтому при `true` **вход в CRM не работает**. На HTTPS — вернуть
  `true`.

Фронты собираются с относительным `/api` (пустые `PUBLIC_API_URL`/`VITE_API_URL`
в `deploy.sh`), поэтому к API обращаются по тому же origin — пересобирать их
при смене IP/домена нужно, но хардкода адреса в коде нет.

Когда появится домен и сертификат — см. раздел «TLS (HTTPS)» ниже и поменяйте
`CORS_ORIGINS`, `COOKIE_SECURE`, `server_name` обратно на домен.

## Первый деплой

1. Установите на VPS Docker и Docker Compose, Bun (`curl -fsSL https://bun.sh/install | bash`).
2. Склонируйте репозиторий, перейдите в корень.
3. Создайте секреты:
   ```bash
   cp infra/.env.example infra/.env
   # отредактируйте: POSTGRES_PASSWORD, ADMIN_PASSWORD (временный пароль админа),
   #                 при необходимости ADMIN_EMAIL.
   # BUILD_WORKER_TOKEN — случайный секрет фоновой публикации (openssl rand -hex 24);
   #                 нужен и сервису-сборщику (см. «Публикация лендинга из CRM»).
   # Для доступа по IP/HTTP CORS_ORIGINS и COOKIE_SECURE уже выставлены верно.
   ```
4. Запустите деплой:
   ```bash
   bun run deploy:vps
   ```
   Скрипт установит зависимости, соберёт `website` и `webapp`, поднимет
   контейнеры и применит миграции Prisma.
5. Создайте первого администратора (один раз):
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
     exec backend bun run --cwd backend db:seed
   ```
   Логин — `ADMIN_EMAIL`, пароль — `ADMIN_PASSWORD`; систему попросит сменить
   пароль при первом входе.

## Публикация лендинга из CRM (Веха 4.2)

Лендинг — статика: данные «запекаются» на сборке. Чтобы правки контента из CRM
можно было вывести на сайт без полного деплоя, на хосте крутится сервис-сборщик
`noesis-site-builder`. CRM сначала сохраняет правки как неопубликованные, а админ
отдельно нажимает «Опубликовать сайт». После этого сборщик опрашивает backend
«нужна ли публикация?» (дебаунс ~2 мин, одна сборка одновременно — логика в
backend) и при необходимости пересобирает сайт.

**Как устроено:**

- backend при изменении публичного контента ставит флажок неопубликованных правок
  (модель `SiteBuild`);
- кнопка «Опубликовать сайт» переводит накопленные правки в очередь сборки;
- сборщик (`infra/site-builder.sh`) забирает задачу через внутренние ручки
  `/api/internal/site-build/*` (защищены `BUILD_WORKER_TOKEN`);
- сборка идёт скриптом `infra/build-website.sh` в новый релиз
  `website/web/releases/<ts>`, и только при УСПЕХЕ симлинк `website/web/current`
  атомарно переключается на него (nginx раздаёт `current`). При сбое сайт
  остаётся на прошлой версии, в Telegram — алерт (тот же чат, что и заявки);
- статус виден в CRM (шапка): «есть изменения / в очереди / публикуется /
  опубликован / ошибка сборки».

**Установка сервиса-сборщика на VPS (один раз):**

```bash
# BUILD_WORKER_TOKEN уже задан в infra/.env (см. «Первый деплой»).
sudo cp infra/noesis-site-builder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now noesis-site-builder
journalctl -u noesis-site-builder -f   # логи сборщика
```

> Юнит рассчитан на каталог деплоя `/root/noesis_adv` и `bun` в
> `/root/.bun/bin`. Если иначе — поправьте `WorkingDirectory`, `EnvironmentFile`
> и `PATH` в `infra/noesis-site-builder.service` перед копированием.

`bun run deploy:vps` собирает лендинг тем же `build-website.sh` (релиз + свап) и
сообщает backend об успешной публикации — ручной деплой и фоновая публикация
сериализованы общим `flock` и не конфликтуют. Если `BUILD_WORKER_TOKEN` не задан
— фоновая публикация просто выключена, всё работает как раньше (только ручной
деплой).

## Переход на домен noesis-grozny.ru

Сейчас сайт открыт по IP без HTTPS. SEO/Метрика завязаны на единый `SITE_URL`,
поэтому переход — это смена конфигов и пересборка, без правок в коде:

1. Направьте домен `noesis-grozny.ru` (A-запись) на IP VPS.
2. Выпустите сертификат (см. «TLS (HTTPS)» ниже) и раскомментируйте HTTPS-блок и
   `server_name noesis-grozny.ru www.noesis-grozny.ru;` в `infra/nginx/default.conf`.
3. В `infra/.env`:
   - `SITE_URL=https://noesis-grozny.ru` (canonical/OG/sitemap/Schema.org);
   - `CORS_ORIGINS=https://noesis-grozny.ru,https://www.noesis-grozny.ru`;
   - `COOKIE_SECURE=true` (на HTTPS — обязательно для входа в CRM).
4. Пересоберите и перезапустите: `bun run deploy:vps`.
5. Проверьте `https://noesis-grozny.ru/`, вход в CRM, отправку заявки.
6. Отдайте `https://noesis-grozny.ru/sitemap.xml` в Яндекс.Вебмастер и Google Search
   Console (на IP индексация фактически не работала). Текст Политики ПДн уже
   ссылается на `noesis-grozny.ru` — править не нужно.
7. Яндекс.Метрика (Веха 4.3): ID счётчика задаётся **в CRM** (вкладка «Сайт» →
   Яндекс.Метрика), не в `.env`. Пока ID пуст — счётчик не грузится. Заведите
   счётчик на домен, впишите ID в CRM, сохраните и нажмите «Опубликовать сайт».

> **Миграции:** `bun run deploy:vps` применяет миграции автоматически
> (`prisma migrate deploy`). Отдельных действий для новых миграций обычно не
> требуется.

## TLS (HTTPS)

В nginx-конфиге HTTPS-блок закомментирован. Самый простой путь:

1. Выпустить сертификат через certbot (standalone или webroot) на хосте.
2. Положить `fullchain.pem` и `privkey.pem` в `infra/certs/`.
3. Раскомментировать `server { listen 443 ... }` в `infra/nginx/default.conf`
   и перезапустить nginx:
   `docker compose -f infra/docker-compose.prod.yml restart nginx`.

## Обновление

> **Bun на этом VPS:** `/root/.bun/bin/bun` (пользователь root). В новой или
> неинтерактивной сессии его может не быть в `PATH` (`bun: command not found`) —
> тогда добавьте его перед деплоем. Чтобы не делать это каждый раз, можно
> один раз дописать строку `export` в `~/.bashrc`.

```bash
export PATH="$HOME/.bun/bin:$PATH"   # если bun не находится
cd /root/noesis_adv                  # каталог деплоя на VPS
git pull origin main
bun run deploy:vps
```

`deploy:vps` поднимает Postgres+backend и применяет миграции, ждёт готовности
backend, прогоняет сид контента (идемпотентно), затем собирает фронты на данных
API и перезапускает nginx с новой статикой.

### Обновление прода без Docker (текущий прод, git → deploy-no-docker.sh)

Действующий прод — **no-Docker**: `root@77.222.32.54`, каталог
`/var/www/noesis_adv`, деплой скриптом `infra/deploy-no-docker.sh`. Каталог
можно вести как git-рабочую копию и катить полностью на VPS. Секреты
(`infra/no-docker.env`) в репозитории нет (в `.gitignore`), поэтому git их не
трогает; сам `deploy-no-docker.sh` git не требует — собирает код, лежащий в
каталоге.

Первый раз (превратить каталог в git-рабочую копию):

```bash
ssh root@77.222.32.54
cd /var/www/noesis_adv
cp infra/no-docker.env ~/no-docker.env.bak        # страховка секретов
git init
git remote add origin https://github.com/invdr/noesis_adv.git
git config --global --add safe.directory /var/www/noesis_adv
# приватный репо: подставить креды один раз, если их нет —
# git remote set-url origin https://<логин>:<PAT>@github.com/invdr/noesis_adv.git
```

Каждое последующее обновление (подставить нужную ветку):

```bash
ssh root@77.222.32.54
cd /var/www/noesis_adv
git fetch origin <ветка>
git reset --hard origin/<ветка>                   # только tracked-файлы; env/dist/node_modules не трогает
ls -l infra/no-docker.env                          # секреты целы; если нет — cp ~/no-docker.env.bak infra/no-docker.env
bash infra/deploy-no-docker.sh
```

`deploy-no-docker.sh` делает: `bun install` → `prisma generate` →
`prisma migrate deploy` (применяет пендинг-миграции) → рестарт backend →
идемпотентный `db:seed` → сборка сайта и CRM → рендер и reload nginx. Гейт
(`typecheck`+`test`) сам скрипт не гоняет — прогнать перед пушем ветки.

Смоук после деплоя:

```bash
systemctl is-active noesis-backend noesis-site-builder nginx
curl -fsS http://127.0.0.1:3001/health
curl -fsSI https://noesis.catlg.ru/
curl -fsSI https://noesis.catlg.ru/crm/
curl -fsSI https://noesis.catlg.ru/catalog/
```

## Замена старой версии на VPS

Если на сервере уже крутится прошлая версия, перед деплоем нужно освободить
порты 80/443 и (по возможности) сохранить данные:

1. Зайдите в каталог старого деплоя и остановите его стек, например:
   ```bash
   docker compose down            # из старого каталога/compose-файла
   # либо разово: docker ps  →  docker stop <id> для контейнеров на :80/:443
   ```
2. Если БД меняется — снимите дамп старой базы (см. «Бэкапы БД»). При переходе
   на этот compose том `postgres_data` создаётся заново; данные не переносятся
   автоматически — восстановите дамп после первого запуска при необходимости.
3. Выкатите новую версию из `main`:
   ```bash
   git fetch origin main
   git checkout main
   cp infra/.env.example infra/.env   # если .env ещё нет — заполнить секреты
   bun run deploy:vps
   ```
4. Один раз создайте администратора (`... exec backend bun run --cwd backend db:seed`) и
   проверьте: `http://<VPS_IP>/` (лендинг) и `http://<VPS_IP>/crm/`
   (вход в CRM).

## Переменные сборки фронта

- Лендинг (`website`): `PUBLIC_API_URL` — базовый URL API. На проде оставьте
  пустым, чтобы форма обращалась к относительному `/api` того же домена.
- `PUBLIC_YANDEX_MAPS_API_KEY` — публичный browser key JavaScript API
  Яндекс.Карт для блока карты на лендинге. Без ключа сайт собирается, но карта
  показывает fallback-сообщение.
- CRM (`webapp`): `VITE_API_URL` — аналогично; пусто → относительный `/api`.

## Бэкапы БД

Том `postgres_data` хранит данные. Регулярный дамп:
```bash
docker compose -f infra/docker-compose.prod.yml exec -T postgres \
  pg_dump -U noesis noesis > backup_$(date +%F).sql
```

## Напоминания о сроке брони (Telegram по cron)

Веб-«Мой день» показывает брони с подходящим сроком всегда (lazy-on-read, без
демонов). Telegram-дайджест ответственному менеджеру — опционально, через
суточный cron (фоновых демонов в приложении нет).

1. В env бэкенда (`infra/no-docker.env` или `infra/.env`) задать секрет и, если
   ещё не заданы, токен бота:
   ```bash
   REMINDER_CRON_TOKEN=$(openssl rand -hex 24)   # запишите в env
   # TELEGRAM_BOT_TOKEN=...                       # общий с уведомлениями о заявках
   ```
   Адресат — личный чат менеджера: у пользователя должен быть заполнен
   `telegramChatId` (иначе бронь пропускается и уведомит позже). Fallback —
   создатель брони.

2. Добавить cron (например, ежедневно в 09:00 МСК = 06:00 UTC) на VPS. Порт
   зависит от способа развёртывания:

   **Docker Compose** (`infra/.env`, backend опубликован на localhost:3000):
   ```bash
   0 6 * * * curl -fsS -X POST -H "X-Reminder-Token: <REMINDER_CRON_TOKEN>" \
     http://127.0.0.1:3000/api/internal/bookings/reminders/notify >/dev/null
   ```

   **Без Docker** (`infra/no-docker.env`, значение `NOESIS_BACKEND_PORT`, по
   умолчанию 3001):
   ```bash
   0 6 * * * curl -fsS -X POST -H "X-Reminder-Token: <REMINDER_CRON_TOKEN>" \
     http://127.0.0.1:3001/api/internal/bookings/reminders/notify >/dev/null
   ```
   Ручка идемпотентна: разосланные напоминания помечаются `reminderNotifiedAt` и
   повторно не шлются; перенос срока брони сбрасывает флаг и перевзвешивает
   уведомление. Без `REMINDER_CRON_TOKEN` ручка отдаёт 404 (рассылка выключена).

## Отличия от шаблона vibe

Шаблон ориентирован на DigitalOcean App Platform / Yandex Cloud (`.do/`,
`scripts/prepare-do-specs.mjs`). Здесь это заменено на самоуправляемый
Docker-стек под один VPS. Архитектура приложения (Hono/Prisma/Astro/React,
общие контракты) сохранена без изменений.
