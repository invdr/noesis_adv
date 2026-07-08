import { Hono } from "hono";
import { reportBuildSchema } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import { claimBuild, markPublished, reportBuildResult } from "./site-build-service";

/**
 * Внутренние ручки для сервиса-сборщика на хосте (server-to-server). Защищены
 * общим секретом `BUILD_WORKER_TOKEN` в заголовке `X-Build-Token`; если токен в
 * окружении не задан — ручки скрыты (404), фоновая публикация не активна. Origin-
 * guard к ним не применяется (см. app.ts) — защита через токен.
 */
export function siteBuildInternalRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const token = rt.env.BUILD_WORKER_TOKEN;
    if (!token) throw new HttpError(404, "not_found", "Не найдено");
    if (c.req.header("x-build-token") !== token) {
      throw new HttpError(401, "unauthorized", "Неверный токен сборщика");
    }
    await next();
  });

  // Сборщик спрашивает: собирать ли сейчас (с учётом дебаунса и сериализации).
  app.get("/claim", async (c) => c.json(await claimBuild(rt)));

  // Сборщик отчитывается о результате (успех/ошибка с хвостом лога).
  app.post("/result", async (c) => {
    const input = reportBuildSchema.parse(await c.req.json().catch(() => ({})));
    await reportBuildResult(rt, input);
    return c.body(null, 204);
  });

  // Ручной деплой (deploy.sh) сообщает об успешной публикации сайта.
  app.post("/published", async (c) => {
    await markPublished(rt);
    return c.body(null, 204);
  });

  return app;
}
