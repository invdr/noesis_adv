import { Hono } from "hono";
import { listContactsQuerySchema, upsertContactSchema } from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requirePasswordChanged, requireRole } from "../http/auth";
import {
  archiveContact,
  getContactDetail,
  createContact,
  deleteContact,
  listContacts,
  restoreContact,
  updateContact,
} from "./contact-service";

/**
 * Роуты контактов (клиенты/риелторы/агентства). Чтение/создание/правка/архив/
 * восстановление доступны всем сотрудникам CRM (per продуктовое решение):
 * видимость клиентов наследуется от заявок в сервисе, партнёры видны всем.
 * Безвозвратное удаление — только admin. Логика — в contact-service.
 */
export function contactRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requirePasswordChanged(rt);
  // Безвозвратное удаление контакта — только admin (у партнёров общий blast-radius
  // на аналитику всех менеджеров); правку/архив/восстановление ведут все сотрудники.
  const adminOnly = requireRole(rt, "admin");

  app.get("/", auth, async (c) => {
    const query = listContactsQuerySchema.parse({
      kind: c.req.query("kind"),
      search: c.req.query("search"),
      includeArchived: c.req.query("includeArchived") === "true",
    });
    return c.json(await listContacts(rt, c.get("user"), query));
  });

  // Полная карточка контакта (клиент — свои заявки, партнёр — приведённые).
  app.get("/:id", auth, async (c) =>
    c.json(await getContactDetail(rt, c.get("user"), c.req.param("id"))),
  );

  app.post("/", auth, async (c) => {
    const input = upsertContactSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createContact(rt, c.get("user"), input), 201);
  });

  app.patch("/:id", auth, async (c) => {
    const input = upsertContactSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateContact(rt, c.get("user"), c.req.param("id"), input));
  });

  app.post("/:id/archive", auth, async (c) =>
    c.json(await archiveContact(rt, c.get("user"), c.req.param("id"))),
  );

  app.post("/:id/restore", auth, async (c) =>
    c.json(await restoreContact(rt, c.get("user"), c.req.param("id"))),
  );

  app.delete("/:id", adminOnly, async (c) => {
    await deleteContact(rt, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
