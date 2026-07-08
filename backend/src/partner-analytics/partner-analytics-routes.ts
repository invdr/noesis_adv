import { Hono } from "hono";
import { partnerAnalyticsQuerySchema } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged } from "../http/auth";
import { getPartnerAnalytics } from "./partner-analytics-service";

/**
 * Роуты аналитики партнёров. Доступны всем сотрудникам CRM (менеджерам тоже):
 * видимость приведённых заявок накладывается в сервисе (менеджер — свои).
 */
export function partnerAnalyticsRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requirePasswordChanged(rt), async (c) => {
    const query = partnerAnalyticsQuerySchema.parse({
      from: c.req.query("from"),
      to: c.req.query("to"),
      kind: c.req.query("kind"),
      search: c.req.query("search"),
    });
    return c.json(await getPartnerAnalytics(rt, c.get("user"), query));
  });

  return app;
}
