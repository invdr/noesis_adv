import { Hono } from "hono";
import { analyticsQuerySchema } from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requireRole } from "../http/auth";
import { getAnalytics } from "./analytics-service";

/** Роуты аналитики заявок. Только admin; расчёт целиком на бэке. */
export function analyticsRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Дашборд за период (когортно по дате поступления заявки).
  app.get("/", requireRole(rt, "admin"), async (c) => {
    const query = analyticsQuerySchema.parse(c.req.query());
    return c.json(await getAnalytics(rt, query));
  });

  return app;
}
