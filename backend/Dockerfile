# Бэкенд ГСК TOWER. Сборка из корня монорепо:
#   docker build -f backend/Dockerfile -t gsk-tower-backend .
FROM oven/bun:1.3.11-alpine

WORKDIR /app

# Манифесты для кэшируемой установки зависимостей. Нужны манифесты ВСЕХ
# воркспейсов из корневого package.json — иначе bun install падает с
# "Workspace not found". Исходники webapp/website при этом не копируем,
# в образ бэка попадают только их зависимости.
COPY package.json bun.lock* ./
COPY backend/package.json ./backend/
COPY packages/contracts/package.json ./packages/contracts/
COPY webapp/package.json ./webapp/
COPY website/package.json ./website/

RUN bun install --frozen-lockfile || bun install

# Исходники
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY backend ./backend

# Prisma client
RUN bun run --cwd backend prisma:generate

EXPOSE 3000
ENV PORT=3000

# Применяем миграции и запускаем API
CMD ["sh", "-c", "bun run --cwd backend prisma:deploy && bun run --cwd backend start"]
