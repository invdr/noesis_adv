import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { clientIp } from "../src/http/request";

/** Мини-контекст Hono: только чтение заголовков. */
function ctx(headers: Record<string, string>): Context {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { req: { header: (name: string) => lower[name.toLowerCase()] } } as unknown as Context;
}

describe("clientIp", () => {
  test("X-Real-IP (ставит nginx) — приоритетный источник", () => {
    expect(
      clientIp(ctx({ "X-Real-IP": "203.0.113.7", "X-Forwarded-For": "6.6.6.6" })),
    ).toBe("203.0.113.7");
  });

  test("из X-Forwarded-For берётся ПОСЛЕДНИЙ адрес (дописанный nginx), не присланный клиентом", () => {
    // Клиент прислал `X-Forwarded-For: 6.6.6.6`, nginx дописал реальный адрес.
    expect(clientIp(ctx({ "X-Forwarded-For": "6.6.6.6, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIp(ctx({ "X-Forwarded-For": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  test("без заголовков (dev без прокси) — unknown", () => {
    expect(clientIp(ctx({}))).toBe("unknown");
  });
});
