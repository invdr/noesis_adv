import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  listNewsQuerySchema,
  MAX_UPLOAD_BYTES,
  upsertNewsSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { parseMultipart } from "../http/multipart";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveNews,
  createNews,
  deleteNews,
  getNews,
  listNews,
  restoreNews,
  updateNews,
} from "./news-service";

/**
 * CRM-роуты новостей. Чтение/создание/правка/архив — manager+admin (ведут
 * контент); удаление навсегда — только admin. Сохранение — multipart: `data`
 * (JSON) + необязательный файл обложки `cover`.
 */
export function newsRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);
  const limit = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) =>
      c.json({ error: { code: "file_too_large", message: "Слишком большой запрос" } }, 413),
  });

  app.get("/", auth, async (c) => {
    const query = listNewsQuerySchema.parse(c.req.query());
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listNews(rt, { ...query, includeArchived }));
  });

  app.post("/", auth, limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = upsertNewsSchema.parse(data);
    const news = await createNews(rt, input, files, c.get("user").id);
    return c.json(news, 201);
  });

  app.get("/:id", auth, async (c) => c.json(await getNews(rt, c.req.param("id"))));

  app.patch("/:id", auth, limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = upsertNewsSchema.parse(data);
    const news = await updateNews(rt, c.req.param("id"), input, files, c.get("user").id);
    return c.json(news);
  });

  app.post("/:id/archive", auth, async (c) =>
    c.json(await archiveNews(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", auth, async (c) =>
    c.json(await restoreNews(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteNews(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
