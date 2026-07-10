import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import { sendDueBookingReminders } from "./booking-reminder-service";

/**
 * Внутренняя ручка cron-рассылки напоминаний о сроке брони (server-to-server).
 * Защищена секретом `REMINDER_CRON_TOKEN` в заголовке `X-Reminder-Token`; если
 * секрет не задан — ручка скрыта (404). Origin-guard не применяется (см. app.ts).
 * Идемпотентна: помечает разосланные напоминания, повторный вызов их не шлёт.
 */
export function bookingReminderInternalRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const token = rt.env.REMINDER_CRON_TOKEN;
    if (!token) throw new HttpError(404, "not_found", "Не найдено");
    if (c.req.header("x-reminder-token") !== token) {
      throw new HttpError(401, "unauthorized", "Неверный токен рассылки");
    }
    await next();
  });

  app.post("/reminders/notify", async (c) =>
    c.json(await sendDueBookingReminders(rt)),
  );

  return app;
}
