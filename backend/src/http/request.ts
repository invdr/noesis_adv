import type { Context } from "hono";
import type { AppEnv } from "./context";

/**
 * IP клиента за обратным прокси (nginx на VPS). Доверяем только тому, что
 * выставляет САМ nginx: `X-Real-IP` (пишется из `$remote_addr`, присланное
 * клиентом значение перезатирается) либо ПОСЛЕДНИЙ адрес из `X-Forwarded-For`
 * (`$proxy_add_x_forwarded_for` дописывает адрес соединения в конец присланной
 * клиентом цепочки). Первый элемент XFF контролирует клиент — по нему бот
 * ротацией выдуманных адресов обходил бы анти-спам приёма заявок и писал бы
 * подделку в `consentIp` (доказательство согласия ПДн, 152-ФЗ).
 */
export function clientIp(c: Context): string {
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return "unknown";
}

/** Архивные строки по query-параметру может запрашивать только admin CRM. */
export function includeArchivedForAdmin(c: Context<AppEnv>): boolean {
  return c.req.query("includeArchived") === "true" && c.get("user").role === "admin";
}
