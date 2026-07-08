# ГСК TOWER — инженерные заметки

Монорепо на **Bun** (workspaces). Структура и конвенции следуют шаблону
[vibe](https://github.com/di-sukharev/vibe), адаптированному под наш проект и
деплой на **VPS sweb.ru** (вместо DigitalOcean / Yandex Cloud).

Требования — в [PRD.md](./PRD.md); декомпозиция и статус по вехам — в
[TASKS.md](./TASKS.md) (источник истины по объёму работ). Готовы Вехи 1–11:
CRM (заявки с ручным приёмом, воронки, контакты с карточками, журналы событий,
справочник источников, аналитика и калькулятор рассрочки), контент лендинга с
отдельной публикацией из CRM, деплой на VPS, CI (GitHub Actions:
typecheck+тесты+E2E-смоук).

## Surfaces

| Папка                | Стек                          | Назначение                                            |
| -------------------- | ----------------------------- | ----------------------------------------------------- |
| `website/`           | Astro (SSG)                   | Публичный лендинг ГСК TOWER (десктоп + мобильная вёрстка), SEO |
| `webapp/`            | React + Vite (CSR)            | Мини-CRM для обработки заявок (за логином)             |
| `backend/`           | Hono + Prisma + PostgreSQL 18 | API заявок/ЖК/новостей                                 |
| `packages/contracts/`| Zod + TypeScript              | Единый источник схем/DTO, общий для фронта и бэка      |
| `mobile/`            | Expo (отдельная ветка)        | Будущее мобильное приложение                           |
| `infra/`             | Docker Compose + nginx        | Деплой на VPS sweb.ru                                  |

## Архитектура бэка

Поток запроса: **route → Zod-валидация → auth/session guard → service → Prisma → DTO**.

- Код бэка сгруппирован по фиче, не по слою: `backend/src/<feature>/` содержит
  `*-routes.ts` (тонкие хендлеры Hono), `*-service.ts` (бизнес-логика) и
  `*-dto.ts` (маппинг Prisma → контракт). Сейчас это `auth/`, `stages/`,
  `leads/`; внешние интеграции — в `notifications/`, http-утилиты — в `http/`.
- Новый эндпоинт начинается со схемы в `packages/contracts`, затем бэк
  валидирует ею вход, а фронт переиспользует её в формах и API-клиенте.
- Видимость данных и права — в сервисе (guard по роли/ответственному), не в БД.
- Статусы заявок — таблица этапов с `kind`; история смен — `LeadStatusEvent`;
  согласие ПДн — поля на `Lead`. Анти-спам и троттлинг — in-memory (один инстанс
  на VPS). Внешние уведомления (Telegram) — «выстрелил-и-забыл», сбой не ломает
  основную операцию.
- Миграции Prisma только через workflow (`prisma:migrate`), не руками.
- Секреты только в локальных `.env` (есть `.env.example`), в репо не коммитим.
  Telegram-уведомления (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`) опциональны:
  если не заданы — заявки создаются как обычно, без уведомления.

## Частые команды

```bash
bun install                 # установка зависимостей
bun run db:up               # поднять Postgres (docker compose)
bun run --cwd backend prisma:migrate   # миграции (dev)
bun run dev                 # все surfaces параллельно
bun run dev:backend|dev:website|dev:webapp
bun run typecheck           # типы по всему монорепо
bun run test                # contracts + backend
bun run build               # прод-сборка всех workspaces
```

## Деплой прода

Прод — VPS sweb.ru (`http://168.222.140.78`), деплой **вручную по SSH на самом
сервере** (автодеплоя/CI нет; из песочницы агента SSH недоступен — сеть окружения
не пускает). На просьбу «обнови прод» давать именно эту процедуру:

```bash
export PATH="$HOME/.bun/bin:$PATH"   # если bun не находится
cd /root/tower-site
git pull origin main
bun run deploy:vps
```

Команда запуска неизменна — все проверки живут внутри `deploy.sh`/`build-website.sh`:
зависимости → гейт (`typecheck`+`test`, при красном прерывается, прод остаётся на
рабочей версии) → Postgres+backend (миграции на старте) → идемпотентный сид →
сборка сайта/CRM с санити «≥1 ЖК» → пересоздание nginx. Аварийный обход гейта —
`SKIP_CHECKS=1 bun run deploy:vps`. Отката нет: roll-forward (чиним и катим заново).

Бэкапы: `bash infra/backup.sh` на VPS (дамп БД + архив файлов, ротация 14 дней,
запуск по cron); восстановление — [docs/backup-restore.md](./docs/backup-restore.md).

## Дизайн

Лендинг в `website/` — это перенос готового дизайна 1:1. **Визуальные стили
не меняем** без явной просьбы. Актуальный источник для продукта — код,
[PRD.md](./PRD.md) и [TASKS.md](./TASKS.md); старые проектные чаты из репозитория
удалены как исторический шум.
