import { Hono } from "hono";
import { createUserSchema, updateUserSchema } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requireRole } from "../http/auth";
import {
  createUserAccount,
  listUsers,
  resetUserPassword,
  setUserActive,
  updateUser,
} from "./user-service";

/** Роуты управления учётками. Только admin (публичной регистрации нет). */
export function userRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const admin = requireRole(rt, "admin");

  // Список учёток.
  app.get("/", admin, async (c) => c.json(await listUsers(rt)));

  // Создать учётку (пароль генерируется и возвращается разово).
  app.post("/", admin, async (c) => {
    const input = createUserSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createUserAccount(rt, input), 201);
  });

  // Сменить email и/или роль.
  app.patch("/:id", admin, async (c) => {
    const input = updateUserSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateUser(rt, c.get("user").id, c.req.param("id"), input));
  });

  // Заблокировать (прекращает сессии, возвращает активные заявки в очередь).
  app.post("/:id/block", admin, async (c) => {
    return c.json(await setUserActive(rt, c.get("user").id, c.req.param("id"), false));
  });

  // Разблокировать.
  app.post("/:id/unblock", admin, async (c) => {
    return c.json(await setUserActive(rt, c.get("user").id, c.req.param("id"), true));
  });

  // Сбросить пароль (новый сгенерированный пароль возвращается разово).
  app.post("/:id/reset-password", admin, async (c) => {
    return c.json(await resetUserPassword(rt, c.get("user").id, c.req.param("id")));
  });

  return app;
}
