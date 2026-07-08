# ГСК TOWER

Монорепо публичного лендинга и CRM ГСК TOWER.

## Состав

| Папка | Назначение |
| --- | --- |
| `website/` | Публичный лендинг на Astro SSG |
| `webapp/` | CRM на React + Vite |
| `backend/` | API на Hono + Prisma + PostgreSQL |
| `packages/contracts/` | Общие Zod-схемы, DTO и бизнес-хелперы |
| `infra/` | Docker Compose, nginx, деплой и фоновые скрипты VPS |
| `mobile/` | Заготовка под будущее мобильное приложение |

## Быстрый старт

```bash
bun install
bun run db:up
bun run --cwd backend prisma:migrate
bun run --cwd backend db:seed
bun run dev
```

Проверки:

```bash
bun run typecheck
bun run test
bun run build
```

## Публикация сайта

Лендинг статический: данные и настройки из CRM попадают в HTML на этапе сборки.
Сохранение контента в CRM только помечает правки как неопубликованные. Чтобы
обновить публичный сайт, админ нажимает «Опубликовать сайт», после чего
фоновый сборщик на VPS пересобирает лендинг и атомарно переключает релиз.

## Прод

Прод работает на VPS sweb.ru: `http://168.222.140.78`.

Обновление на сервере:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /root/tower-site
git pull origin main
bun run deploy:vps
```

Подробности: [docs/DEPLOYMENT_VPS.md](docs/DEPLOYMENT_VPS.md).

## Документы

- [PRD.md](PRD.md) — продуктовые и технические рамки.
- [TASKS.md](TASKS.md) — декомпозиция по вехам и текущий статус.
- [docs/DEPLOYMENT_VPS.md](docs/DEPLOYMENT_VPS.md) — деплой, домен, TLS, публикация.
- [docs/backup-restore.md](docs/backup-restore.md) — бэкапы и восстановление.
- [docs/files-storage.md](docs/files-storage.md) — хранение файлов.
- [docs/projects.md](docs/projects.md) — ЖК и застройщики.
- [docs/privacy-policy-source.md](docs/privacy-policy-source.md) — исходник политики ПДн.
