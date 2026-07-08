import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import { getPublicProjectBySlug, listPublicProjects } from "./project-service";

/**
 * Публичные роуты ЖК для лендинга (без авторизации). Отдают только
 * опубликованные не-архивные ЖК; страница по slug — только обычный ЖК,
 * «скоро» (тизер без страницы) даёт 404.
 */
export function publicProjectRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await listPublicProjects(rt)));

  app.get("/:slug", async (c) => {
    const project = await getPublicProjectBySlug(rt, c.req.param("slug"));
    if (!project) throw new HttpError(404, "not_found", "ЖК не найден");
    return c.json(project);
  });

  return app;
}
