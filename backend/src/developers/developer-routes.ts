import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_UPLOAD_BYTES, upsertDeveloperSchema } from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { parseMultipart } from "../http/multipart";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveDeveloper,
  createDeveloper,
  deleteDeveloper,
  listDevelopers,
  restoreDeveloper,
  updateDeveloper,
} from "./developer-service";

/**
 * Роуты застройщиков. Чтение — любой сотрудник CRM (нужно для выбора в форме
 * ЖК); ведение справочника (создание/правка/архив/удаление) — только admin.
 * Создание/правка — multipart: `data` (JSON) + необязательный файл `logo`.
 */
export function developerRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const limit = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) =>
      c.json({ error: { code: "file_too_large", message: "Файл слишком большой" } }, 413),
  });

  app.get("/", requirePasswordChanged(rt), async (c) => {
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listDevelopers(rt, { includeArchived }));
  });

  app.post("/", requireRole(rt, "admin"), limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = upsertDeveloperSchema.parse(data);
    const dev = await createDeveloper(rt, input, files.get("logo"), c.get("user").id);
    return c.json(dev, 201);
  });

  app.patch("/:id", requireRole(rt, "admin"), limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = upsertDeveloperSchema.parse(data);
    const dev = await updateDeveloper(
      rt,
      c.req.param("id"),
      input,
      files.get("logo"),
      c.get("user").id,
    );
    return c.json(dev);
  });

  app.post("/:id/archive", requireRole(rt, "admin"), async (c) =>
    c.json(await archiveDeveloper(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", requireRole(rt, "admin"), async (c) =>
    c.json(await restoreDeveloper(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteDeveloper(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
