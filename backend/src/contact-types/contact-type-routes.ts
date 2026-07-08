import { Hono } from "hono";
import {
  reorderContactTypesSchema,
  upsertContactTypeSchema,
} from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveContactType,
  createContactType,
  deleteContactType,
  listContactTypes,
  reorderContactTypes,
  restoreContactType,
  updateContactType,
} from "./contact-type-service";

/**
 * Роуты справочника типов контакта. Чтение — любой сотрудник CRM (нужен выбор
 * в карточке заявки); ведение справочника — только admin.
 */
export function contactTypeRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requirePasswordChanged(rt), async (c) => {
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listContactTypes(rt, { includeArchived }));
  });

  app.post("/", requireRole(rt, "admin"), async (c) => {
    const input = upsertContactTypeSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createContactType(rt, input), 201);
  });

  app.patch("/reorder", requireRole(rt, "admin"), async (c) => {
    const input = reorderContactTypesSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await reorderContactTypes(rt, input));
  });

  app.patch("/:id", requireRole(rt, "admin"), async (c) => {
    const input = upsertContactTypeSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateContactType(rt, c.req.param("id"), input));
  });

  app.post("/:id/archive", requireRole(rt, "admin"), async (c) =>
    c.json(await archiveContactType(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", requireRole(rt, "admin"), async (c) =>
    c.json(await restoreContactType(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteContactType(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
