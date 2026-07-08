import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import { getPublicNewsBySlug, listPublicNews } from "./news-service";

/**
 * Публичные роуты новостей для лендинга (без авторизации). Отдают только
 * опубликованные не-архивные новости, от новых к старым; статья — по slug.
 */
export function publicNewsRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await listPublicNews(rt)));

  app.get("/:slug", async (c) => {
    const news = await getPublicNewsBySlug(rt, c.req.param("slug"));
    if (!news) throw new HttpError(404, "not_found", "Новость не найдена");
    return c.json(news);
  });

  return app;
}
