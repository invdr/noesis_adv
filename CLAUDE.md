# Noesis — инженерные заметки

Монорепо на **Bun** (workspaces): CRM и публичный сайт рекламного агентства
**Noesis** (продажа рекламы на сити-форматах в Грозном).

Собрано на основе [tower-site](https://github.com/invdr/tower-site). Переиспользовано домен-независимое ядро CRM; удалены
калькулятор рассрочки и планировки квартир; выполнены ребрендинг и перекраска.
Требования — в [PRD.md](./PRD.md); статус и задачи — в [TASKS.md](./TASKS.md).

## Старт сессии

Перед работой прочитай ключевые файлы контекста:
[current_handoff.md](./current_handoff.md) — **живое** состояние и договорённости
между сессиями (текущий фокус, решения, открытые вопросы); [PRD.md](./PRD.md) —
продуктовые рамки; [TASKS.md](./TASKS.md) — этапы и статусы. `current_handoff.md` —
источник правды по текущей работе: держи его в актуальном состоянии и обновляй по ходу.

## Состояние

Готово и переиспользуется (из tower-site): CRM (заявки с ручным приёмом,
воронки, контакты с карточками, журналы событий, справочники, аналитика,
«Мой день»), контент сайта с отдельной публикацией из CRM, деплой на VPS, CI.

Готово (Этап 1): каталог **конструкций** — модель `Construction` (замена `Project`)
с гео/форматом/стороной/подсветкой/охватом/ценой за месяц, CRM-редактор и
API (`/api/constructions`). Публичный сайт читает `/api/public/constructions`,
карточки живут на `/constructions/<slug>`, заявки отправляют `constructionId`.
Базовая Яндекс.Карта на главной центрируется на Грозном и берёт пины из координат
конструкций. Предстоит (см. TASKS.md): сетка занятости на публичной карте, карта
в карточке CRM и визуальный редизайн сайта. `Developer` переиспользуется как
«владелец сети».

## Surfaces

| Папка                | Стек                          | Назначение                                            |
| -------------------- | ----------------------------- | ----------------------------------------------------- |
| `website/`           | Astro (SSG)                   | Публичный сайт (десктоп + мобильная вёрстка), SEO     |
| `webapp/`            | React + Vite (CSR)            | CRM за логином                                        |
| `backend/`           | Hono + Prisma + PostgreSQL 18 | API                                                   |
| `packages/contracts/`| Zod + TypeScript              | Единый источник схем/DTO, общий для фронта и бэка     |
| `mobile/`            | Expo (заготовка)              | Будущее мобильное приложение                          |
| `infra/`             | Docker Compose + nginx        | Деплой на VPS                                         |

## Архитектура бэка

Поток запроса: **route → Zod-валидация → auth/session guard → service → Prisma → DTO**.

- Код бэка сгруппирован по фиче, не по слою: `backend/src/<feature>/` содержит
  `*-routes.ts` (тонкие хендлеры Hono), `*-service.ts` (бизнес-логика) и
  `*-dto.ts` (маппинг Prisma → контракт).
- Новый эндпоинт начинается со схемы в `packages/contracts`, затем бэк
  валидирует ею вход, а фронт переиспользует её в формах и API-клиенте.
- Видимость данных и права — в сервисе (guard по роли/ответственному), не в БД.
- Статусы заявок — таблица этапов с `kind`; история смен — `LeadStatusEvent`;
  согласие ПДн — поля на `Lead`. Анти-спам и троттлинг — in-memory (один инстанс
  на VPS). Внешние уведомления (Telegram) — «выстрелил-и-забыл».
- Миграции Prisma только через workflow (`prisma:migrate`), не руками. История
  миграций схлопнута в одну начальную (`20260708000000_init`) — продовой БД ещё
  нет; при появлении прода дальше только инкрементальные миграции.
- Секреты только в локальных `.env` (есть `.env.example`), в репо не коммитим.

## Частые команды

```bash
bun install                 # установка зависимостей
bun run db:up               # поднять Postgres (docker compose)
bun run --cwd backend prisma:migrate   # миграции (dev)
bun run dev                 # все surfaces параллельно
bun run dev:backend|dev:website|dev:webapp
bun run typecheck           # типы по всему монорепо
bun run test                # contracts + backend + webapp + website
bun run build               # прод-сборка всех workspaces
```

## Деплой прода

Прод — VPS, деплой **вручную по SSH на самом сервере** (автодеплоя/CI нет; из
песочницы агента SSH недоступен). Сервер, домен и секреты задаются при
провижининге — см. [docs/DEPLOYMENT_VPS.md](./docs/DEPLOYMENT_VPS.md).

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /root/noesis_adv
git pull origin main
bun run deploy:vps
```

Команда запуска неизменна — все проверки живут внутри `deploy.sh`/`build-website.sh`:
зависимости → гейт (`typecheck`+`test`, при красном прерывается) → Postgres+backend
(миграции на старте) → идемпотентный сид → сборка сайта/CRM → пересоздание nginx.
Аварийный обход гейта — `SKIP_CHECKS=1 bun run deploy:vps`. Отката нет: roll-forward.

**«Обнови деплой» (действующий прод — no-Docker, `root@77.222.32.54`,
`/var/www/noesis_adv`).** SSH из песочницы агента нет — выдать пользователю
команды для запуска на VPS (полный рецепт и первичная настройка git-копии —
[docs/DEPLOYMENT_VPS.md](./docs/DEPLOYMENT_VPS.md) → «Обновление прода без Docker»):

```bash
ssh root@77.222.32.54
cd /var/www/noesis_adv
git fetch origin <ветка>
git reset --hard origin/<ветка>   # tracked-файлы; no-docker.env/dist/node_modules не трогает
bash infra/deploy-no-docker.sh    # bun install → migrate deploy → seed → сборка сайта/CRM → nginx
```

Перед этим ветка должна быть запушена, а гейт (`bun run typecheck`+`test`) —
зелёным (сам `deploy-no-docker.sh` гейт не гоняет).

Бэкапы: `bash infra/backup.sh` на VPS от root (читает `infra/no-docker.env`,
снимает дамп через системного пользователя `postgres`); восстановление —
[docs/backup-restore.md](./docs/backup-restore.md).

## Дизайн

Акцент — **тёмно-красный** (`#A4161A`), фон светлый, синего в палитре нет
(`website/public/css/styles.css` — токены `--accent*`; `webapp/src/ui/theme.css`
— `--primary`). Публичный сайт уже переведён на домен наружной рекламы, но
визуальный редизайн остаётся отдельной задачей (TASKS.md).
