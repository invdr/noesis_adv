# Бэкенд Noesis. Сборка из корня монорепо:
#   docker build -f backend/Dockerfile -t noesis-backend .
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
COPY infra/docker-backend-entrypoint.sh /usr/local/bin/noesis-backend

# Prisma client
RUN bun run --cwd backend prisma:generate
RUN chmod +x /usr/local/bin/noesis-backend

EXPOSE 3000
ENV PORT=3000

# Применяем миграции и запускаем API
CMD ["/usr/local/bin/noesis-backend"]
