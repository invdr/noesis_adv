import { Hono } from "hono";
import { inventoryAnalyticsQuerySchema } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged } from "../http/auth";
import { getInventoryAnalytics } from "./inventory-analytics-service";

export function inventoryAnalyticsRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);

  app.get("/", auth, async (c) => {
    const query = inventoryAnalyticsQuerySchema.parse(c.req.query());
    return c.json(await getInventoryAnalytics(rt, query));
  });

  return app;
}
