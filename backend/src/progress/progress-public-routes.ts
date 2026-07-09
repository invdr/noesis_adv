import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import { listPublicConstructionProgress } from "./progress-service";

/**
 * Публичный роут фотоотчётов для лендинга (без авторизации):
 * `GET /construction/:slug` — непустые альбомы конструкции от новых месяцев к старым.
 */
export function publicProgressRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/construction/:slug", async (c) => {
    const albums = await listPublicConstructionProgress(rt, c.req.param("slug"));
    if (!albums) throw new HttpError(404, "not_found", "Конструкция не найдена");
    return c.json(albums);
  });

  return app;
}
