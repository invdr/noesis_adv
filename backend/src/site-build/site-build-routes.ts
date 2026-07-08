import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { getStatus, requestSitePublish } from "./site-build-service";

/**
 * Статус публикации лендинга для индикатора в CRM (Веха 4.2). Доступно всем
 * аутентифицированным сотрудникам (admin и manager).
 */
export function siteBuildRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requirePasswordChanged(rt), async (c) =>
    c.json(await getStatus(rt)),
  );

  // CRM: явная публикация всех накопленных правок публичного сайта.
  app.post("/request", requireRole(rt, "admin"), async (c) =>
    c.json(await requestSitePublish(rt)),
  );

  return app;
}
