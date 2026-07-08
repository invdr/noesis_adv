import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import { listPublicProjectProgress } from "./progress-service";

/**
 * Публичный роут хода строительства для лендинга (без авторизации):
 * `GET /project/:slug` — непустые альбомы ЖК от новых месяцев к старым.
 */
export function publicProgressRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/project/:slug", async (c) => {
    const albums = await listPublicProjectProgress(rt, c.req.param("slug"));
    if (!albums) throw new HttpError(404, "not_found", "ЖК не найден");
    return c.json(albums);
  });

  return app;
}
