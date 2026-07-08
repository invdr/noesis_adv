import { Hono } from "hono";
import {
  reorderDocumentCategoriesSchema,
  upsertDocumentCategorySchema,
} from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveDocumentCategory,
  createDocumentCategory,
  deleteDocumentCategory,
  listDocumentCategories,
  reorderDocumentCategories,
  restoreDocumentCategory,
  updateDocumentCategory,
} from "./document-category-service";

/**
 * Роуты общего справочника категорий документов. Чтение — любой сотрудник CRM
 * (нужно для раскладки документов в карточке ЖК); ведение — только admin.
 */
export function documentCategoryRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requirePasswordChanged(rt), async (c) => {
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listDocumentCategories(rt, { includeArchived }));
  });

  app.post("/", requireRole(rt, "admin"), async (c) => {
    const input = upsertDocumentCategorySchema.parse(await c.req.json());
    return c.json(await createDocumentCategory(rt, input), 201);
  });

  app.patch("/reorder", requireRole(rt, "admin"), async (c) => {
    const input = reorderDocumentCategoriesSchema.parse(await c.req.json());
    return c.json(await reorderDocumentCategories(rt, input));
  });

  app.patch("/:id", requireRole(rt, "admin"), async (c) => {
    const input = upsertDocumentCategorySchema.parse(await c.req.json());
    return c.json(await updateDocumentCategory(rt, c.req.param("id"), input));
  });

  app.post("/:id/archive", requireRole(rt, "admin"), async (c) =>
    c.json(await archiveDocumentCategory(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", requireRole(rt, "admin"), async (c) =>
    c.json(await restoreDocumentCategory(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteDocumentCategory(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
