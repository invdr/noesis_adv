import { Hono } from "hono";
import { listBookingsQuerySchema, upsertBookingSchema } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged } from "../http/auth";
import {
  cancelBooking,
  createBooking,
  getBooking,
  listBookings,
  updateBooking,
} from "./booking-service";

export function bookingRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);

  app.get("/", auth, async (c) => {
    const query = listBookingsQuerySchema.parse(c.req.query());
    return c.json(await listBookings(rt, query));
  });

  app.post("/", auth, async (c) => {
    const input = upsertBookingSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createBooking(rt, c.get("user"), input), 201);
  });

  app.get("/:id", auth, async (c) => c.json(await getBooking(rt, c.req.param("id"))));

  app.patch("/:id", auth, async (c) => {
    const input = upsertBookingSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateBooking(rt, c.get("user"), c.req.param("id"), input));
  });

  app.post("/:id/cancel", auth, async (c) =>
    c.json(await cancelBooking(rt, c.get("user"), c.req.param("id"))),
  );

  return app;
}
