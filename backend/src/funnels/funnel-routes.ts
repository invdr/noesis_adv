import { Hono } from "hono";
import {
  createFunnelSchema,
  reorderFunnelsSchema,
  updateFunnelSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import {
  archiveFunnel,
  createFunnel,
  listFunnels,
  reorderFunnels,
  updateFunnel,
} from "./funnel-service";

/** Роуты воронок. Чтение — все роли; настройка — только admin. */
export function funnelRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Список воронок (для выбора в заявках и для админ-экрана).
  app.get("/", requirePasswordChanged(rt), async (c) => {
    return c.json(await listFunnels(rt));
  });

  // Создать воронку (со стартовым набором этапов).
  app.post("/", requireRole(rt, "admin"), async (c) => {
    const input = createFunnelSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createFunnel(rt, input), 201);
  });

  // Переставить порядок воронок.
  app.patch("/reorder", requireRole(rt, "admin"), async (c) => {
    const { ids } = reorderFunnelsSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await reorderFunnels(rt, ids));
  });

  // Переименовать / назначить воронкой по умолчанию.
  app.patch("/:id", requireRole(rt, "admin"), async (c) => {
    const input = updateFunnelSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateFunnel(rt, c.req.param("id"), input));
  });

  // Архивировать воронку (вместе с этапами).
  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    return c.json(await archiveFunnel(rt, c.req.param("id")));
  });

  return app;
}
