import { Hono } from "hono";
import {
  reorderBookingServiceReasonsSchema,
  upsertBookingServiceReasonSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveBookingServiceReason,
  createBookingServiceReason,
  deleteBookingServiceReason,
  listBookingServiceReasons,
  reorderBookingServiceReasons,
  restoreBookingServiceReason,
  updateBookingServiceReason,
} from "./booking-dictionaries-service";

export function bookingServiceReasonRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requirePasswordChanged(rt), async (c) => {
    const includeArchived = includeArchivedForAdmin(c);
    return c.json(await listBookingServiceReasons(rt, { includeArchived }));
  });

  app.post("/", requireRole(rt, "admin"), async (c) => {
    const input = upsertBookingServiceReasonSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    return c.json(await createBookingServiceReason(rt, input), 201);
  });

  app.patch("/reorder", requireRole(rt, "admin"), async (c) => {
    const input = reorderBookingServiceReasonsSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    return c.json(await reorderBookingServiceReasons(rt, input));
  });

  app.patch("/:id", requireRole(rt, "admin"), async (c) => {
    const input = upsertBookingServiceReasonSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    return c.json(await updateBookingServiceReason(rt, c.req.param("id"), input));
  });

  app.post("/:id/archive", requireRole(rt, "admin"), async (c) =>
    c.json(await archiveBookingServiceReason(rt, c.req.param("id"))),
  );

  app.post("/:id/restore", requireRole(rt, "admin"), async (c) =>
    c.json(await restoreBookingServiceReason(rt, c.req.param("id"))),
  );

  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    await deleteBookingServiceReason(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
