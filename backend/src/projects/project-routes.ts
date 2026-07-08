import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  listProjectsQuerySchema,
  PROJECT_UPLOAD_MAX_BYTES,
  upsertProjectSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { parseMultipart } from "../http/multipart";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  restoreProject,
  updateProject,
} from "./project-service";

/**
 * CRM-роуты ЖК. Чтение/создание/правка/архив — manager+admin (создают контент);
 * удаление навсегда — только admin. Сохранение — multipart: `data` (JSON) +
 * новые фото `image_0`, `image_1`, … (см. docs/files-storage.md, решение №1).
 */
export function projectRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);
  const limit = bodyLimit({
    maxSize: PROJECT_UPLOAD_MAX_BYTES,
    onError: (c) =>
      c.json({ error: { code: "file_too_large", message: "Слишком большой запрос" } }, 413),
  });

  app.get("/", auth, async (c) => {
    const query = listProjectsQuerySchema.parse(c.req.query());
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listProjects(rt, { ...query, includeArchived }));
  });

  app.post("/", auth, limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = upsertProjectSchema.parse(data);
    const project = await createProject(rt, input, files, c.get("user").id);
    return c.json(project, 201);
  });

  app.get("/:id", auth, async (c) => c.json(await getProject(rt, c.req.param("id"))));

  app.patch("/:id", auth, limit, async (c) => {
    const { data, files } = await parseMultipart(c);
    const input = upsertProjectSchema.parse(data);
    const project = await updateProject(rt, c.req.param("id"), input, files, c.get("user").id);
    return c.json(project);
  });

  app.post("/:id/archive", auth, async (c) =>
    c.json(await archiveProject(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", auth, async (c) =>
    c.json(await restoreProject(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteProject(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
