import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { getResolvedSettings } from "./site-settings-service";

/**
 * Публичный роут настроек сайта — полный набор (дефолты + переопределения).
 * Потребляется лендингом на этапе сборки (SSG). Без авторизации, только чтение.
 */
export function publicSiteSettingsRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await getResolvedSettings(rt)));

  return app;
}
