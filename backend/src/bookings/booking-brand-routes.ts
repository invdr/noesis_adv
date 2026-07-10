import { Hono } from "hono";
import {
  reorderBookingBrandsSchema,
  upsertBookingBrandSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveBookingBrand,
  createBookingBrand,
  deleteBookingBrand,
  listBookingBrands,
  reorderBookingBrands,
  restoreBookingBrand,
  updateBookingBrand,
} from "./booking-dictionaries-service";

export function bookingBrandRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requirePasswordChanged(rt), async (c) => {
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listBookingBrands(rt, { includeArchived }));
  });

  // Быстрое добавление бренда — часть формы брони: менеджер не должен идти к
  // администратору только чтобы завести нового рекламодателя. Управление уже
  // созданным справочником (правка, порядок, архив) остаётся только у admin.
  app.post("/", requirePasswordChanged(rt), async (c) => {
    const input = upsertBookingBrandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createBookingBrand(rt, input), 201);
  });

  app.patch("/reorder", requireRole(rt, "admin"), async (c) => {
    const input = reorderBookingBrandsSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await reorderBookingBrands(rt, input));
  });

  app.patch("/:id", requireRole(rt, "admin"), async (c) => {
    const input = upsertBookingBrandSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateBookingBrand(rt, c.req.param("id"), input));
  });

  app.post("/:id/archive", requireRole(rt, "admin"), async (c) =>
    c.json(await archiveBookingBrand(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", requireRole(rt, "admin"), async (c) =>
    c.json(await restoreBookingBrand(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteBookingBrand(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
