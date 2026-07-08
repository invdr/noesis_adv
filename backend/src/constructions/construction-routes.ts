import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  CONSTRUCTION_UPLOAD_MAX_BYTES,
  listConstructionsQuerySchema,
  upsertConstructionSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { parseMultipart } from "../http/multipart";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveConstruction,
  createConstruction,
  deleteConstruction,
  getConstruction,
  listConstructions,
  restoreConstruction,
  updateConstruction,
} from "./construction-service";

/**
 * CRM-роуты конструкций. Чтение/создание/правка/архив — manager+admin (создают
 * контент); удаление навсегда — только admin. Сохранение — multipart: `data`
 * (JSON) + новые фото `image_0`, `image_1`, … (см. docs/files-storage.md).
 */
export function constructionRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);
  const limit = bodyLimit({
    maxSize: CONSTRUCTION_UPLOAD_MAX_BYTES,
    onError: (c) =>
      c.json({ error: { code: "file_too_large", message: "Слишком большой запрос" } }, 413),
  });

  app.get("/", auth, async (c) => {
    const query = listConstructionsQuerySchema.parse(c.req.query());
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listConstructions(rt, { ...query, includeArchived }));
  });

  app.post("/", auth, limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = upsertConstructionSchema.parse(data);
    const construction = await createConstruction(rt, input, files, c.get("user").id);
    return c.json(construction, 201);
  });

  app.get("/:id", auth, async (c) => c.json(await getConstruction(rt, c.req.param("id"))));

  app.patch("/:id", auth, limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = upsertConstructionSchema.parse(data);
    const construction = await updateConstruction(
      rt,
      c.req.param("id"),
      input,
      files,
      c.get("user").id,
    );
    return c.json(construction);
  });

  app.post("/:id/archive", auth, async (c) =>
    c.json(await archiveConstruction(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", auth, async (c) =>
    c.json(await restoreConstruction(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteConstruction(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
