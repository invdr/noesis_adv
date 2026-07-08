import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import {
  listPublicDocumentCategories,
  listPublicProjectDocuments,
} from "./document-service";

/**
 * Публичные роуты документов для лендинга (без авторизации):
 * - `GET /` — карта «категория → ЖК» для блока на главной (от категории к ЖК);
 * - `GET /project/:slug` — документы ЖК, сгруппированные по категориям.
 */
export function publicDocumentRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await listPublicDocumentCategories(rt)));

  app.get("/project/:slug", async (c) => {
    const groups = await listPublicProjectDocuments(rt, c.req.param("slug"));
    if (!groups) throw new HttpError(404, "not_found", "ЖК не найден");
    return c.json(groups);
  });

  return app;
}
