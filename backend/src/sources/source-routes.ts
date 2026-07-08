import { Hono } from "hono";
import {
  reorderLeadSourcesSchema,
  upsertLeadSourceSchema,
} from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveLeadSource,
  createLeadSource,
  deleteLeadSource,
  listLeadSources,
  reorderLeadSources,
  restoreLeadSource,
  updateLeadSource,
} from "./source-service";

/**
 * Роуты справочника источников заявок. Чтение — любой сотрудник CRM (нужен
 * выбор в фильтрах/карточке/ручном приёме); ведение — только admin.
 */
export function sourceRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requirePasswordChanged(rt), async (c) => {
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listLeadSources(rt, { includeArchived }));
  });

  app.post("/", requireRole(rt, "admin"), async (c) => {
    const input = upsertLeadSourceSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createLeadSource(rt, input), 201);
  });

  app.patch("/reorder", requireRole(rt, "admin"), async (c) => {
    const input = reorderLeadSourcesSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await reorderLeadSources(rt, input));
  });

  app.patch("/:id", requireRole(rt, "admin"), async (c) => {
    const input = upsertLeadSourceSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateLeadSource(rt, c.req.param("id"), input));
  });

  app.post("/:id/archive", requireRole(rt, "admin"), async (c) =>
    c.json(await archiveLeadSource(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", requireRole(rt, "admin"), async (c) =>
    c.json(await restoreLeadSource(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteLeadSource(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
