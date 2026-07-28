import { Hono } from "hono";
import { updateSiteSettingsSchema } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requireRole } from "../http/auth";
import { getRawSettings, updateSettings } from "./site-settings-service";

/**
 * CRM-роуты настроек «обвязки» сайта (Веха 4.3). Только admin: GET отдаёт сырые
 * переопределения + метку версии для предзаполнения формы; PUT сохраняет с
 * блокировкой по версии. Успешная мутация ставит флажок пересборки (middleware
 * `rebuildOnMutation` по префиксу `/api/site-settings`).
 */
export function siteSettingsRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireRole(rt, "admin"), async (c) => c.json(await getRawSettings(rt)));

  app.put("/", requireRole(rt, "admin"), async (c) => {
    const input = updateSiteSettingsSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateSettings(rt, input));
  });

  return app;
}
