import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-смоук CRM: реальный стек (Postgres + backend + собранный webapp через
 * vite preview). Запуск — `bun run e2e`; стек поднимает CI (job e2e) или
 * разработчик руками: `bun run db:up` → миграции+сид → `bun run dev:backend` →
 * `vite preview` webapp. Базовый URL переопределяется `E2E_BASE_URL`.
 */
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  // Смоук линейный (один сценарий мутирует БД) — без параллелизма. Ретраи
  // выключены: сценарий необратимо меняет пароль сид-админа, поэтому повторный
  // прогон логинился бы уже другим паролём.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
