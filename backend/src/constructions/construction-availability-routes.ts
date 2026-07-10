import { Hono } from "hono";
import { publicAvailabilityQuerySchema } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { getPublicAvailability } from "./construction-availability";

export function publicConstructionAvailabilityRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const query = publicAvailabilityQuerySchema.parse(c.req.query());
    return c.json(await getPublicAvailability(rt, query));
  });

  return app;
}
