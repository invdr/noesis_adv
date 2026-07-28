import { Hono } from "hono";
import {
  reorderNewsLabelsSchema,
  upsertNewsLabelSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveNewsLabel,
  createNewsLabel,
  deleteNewsLabel,
  listNewsLabels,
  reorderNewsLabels,
  restoreNewsLabel,
  updateNewsLabel,
} from "./news-label-service";

/**
 * Роуты справочника меток новостей. Чтение — любой сотрудник CRM (нужно для
 * выбора в форме новости); ведение справочника — только admin.
 */
export function newsLabelRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requirePasswordChanged(rt), async (c) => {
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listNewsLabels(rt, { includeArchived }));
  });

  app.post("/", requireRole(rt, "admin"), async (c) => {
    const input = upsertNewsLabelSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createNewsLabel(rt, input), 201);
  });

  app.patch("/reorder", requireRole(rt, "admin"), async (c) => {
    const input = reorderNewsLabelsSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await reorderNewsLabels(rt, input));
  });

  app.patch("/:id", requireRole(rt, "admin"), async (c) => {
    const input = upsertNewsLabelSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateNewsLabel(rt, c.req.param("id"), input));
  });

  app.post("/:id/archive", requireRole(rt, "admin"), async (c) =>
    c.json(await archiveNewsLabel(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", requireRole(rt, "admin"), async (c) =>
    c.json(await restoreNewsLabel(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteNewsLabel(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
