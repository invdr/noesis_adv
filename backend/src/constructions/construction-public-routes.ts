import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import {
  getPublicConstructionBySlug,
  listPublicConstructions,
} from "./construction-service";

/**
 * Публичные роуты конструкций для лендинга (без авторизации). Отдают только
 * опубликованные не-архивные конструкции; страница по slug — то же.
 */
export function publicConstructionRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await listPublicConstructions(rt)));

  app.get("/:slug", async (c) => {
    const construction = await getPublicConstructionBySlug(rt, c.req.param("slug"));
    if (!construction) throw new HttpError(404, "not_found", "Конструкция не найдена");
    return c.json(construction);
  });

  return app;
}
