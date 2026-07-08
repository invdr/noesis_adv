import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { getPublicSiteStats } from "./site-stats-service";

export function publicSiteStatsRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await getPublicSiteStats(rt)));

  return app;
}
