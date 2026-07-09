import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import {
  listPublicDocumentCategories,
  listPublicConstructionDocuments,
} from "./document-service";

/**
 * Публичные роуты документов для лендинга (без авторизации):
 * - `GET /` — карта «категория → конструкция» для блока на главной;
 * - `GET /construction/:slug` — документы конструкции, сгруппированные по категориям.
 */
export function publicDocumentRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await listPublicDocumentCategories(rt)));

  app.get("/construction/:slug", async (c) => {
    const groups = await listPublicConstructionDocuments(rt, c.req.param("slug"));
    if (!groups) throw new HttpError(404, "not_found", "Конструкция не найдена");
    return c.json(groups);
  });

  return app;
}
