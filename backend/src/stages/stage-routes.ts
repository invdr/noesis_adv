import { Hono } from "hono";
import {
  archiveStageSchema,
  createStageSchema,
  reorderStagesSchema,
  updateStageSchema,
} from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import { includeArchivedForAdmin } from "../http/request";
import {
  archiveStage,
  createStage,
  listStages,
  reorderStages,
  updateStage,
} from "./stage-service";

/** Роуты воронки статусов. Чтение — все роли; настройка — только admin. */
export function stageRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Список этапов (для перевода заявок и для админ-экрана).
  app.get("/", requirePasswordChanged(rt), async (c) => {
    const includeArchived = includeArchivedForAdmin(c);
    const funnelId = c.req.query("funnelId") || undefined;
    return c.json(await listStages(rt, { includeArchived, funnelId }));
  });

  // Создать этап.
  app.post("/", requireRole(rt, "admin"), async (c) => {
    const input = createStageSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createStage(rt, input), 201);
  });

  // Переставить порядок (весь список id одним запросом).
  app.patch("/reorder", requireRole(rt, "admin"), async (c) => {
    const { ids } = reorderStagesSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await reorderStages(rt, ids));
  });

  // Переименовать / сменить тип / назначить входным.
  app.patch("/:id", requireRole(rt, "admin"), async (c) => {
    const input = updateStageSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateStage(rt, c.req.param("id"), input));
  });

  // Архивировать с переносом заявок.
  app.delete("/:id", requireRole(rt, "admin"), async (c) => {
    const input = archiveStageSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await archiveStage(rt, c.req.param("id"), input));
  });

  return app;
}
