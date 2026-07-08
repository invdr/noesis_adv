import { createApp } from "./app";
import { createRuntime } from "./runtime";
import { startSessionSweeper } from "./auth/auth-service";
import { startBuildStallWatcher } from "./site-build/site-build-service";

const rt = createRuntime();
const app = createApp(rt);

// Периодическая уборка протухших сессий из БД.
startSessionSweeper(rt);

// Сторожок простоя публикации лендинга (алерт, если сборщик не работает).
startBuildStallWatcher(rt);

console.log(`API ГСК TOWER слушает порт ${rt.env.PORT}`);

export default {
  port: rt.env.PORT,
  fetch: app.fetch,
  // Дефолтный кап Bun — 128 МиБ: сохранение ЖК с полной галереей
  // (PROJECT_UPLOAD_MAX_BYTES ≈ 302 МБ) получало бы голый 413 от рантайма
  // до Hono. Поднимаем ровно до client_max_body_size в nginx (320m): всё,
  // что пропустил nginx, доходит до bodyLimit роутов и получает JSON-ошибку,
  // понятную CRM; голый 413 Bun становится недостижим.
  maxRequestBodySize: 320 * 1024 * 1024,
};
