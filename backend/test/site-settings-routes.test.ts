import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Runtime } from "../src/runtime";
import { SITE_SETTINGS_ID } from "../src/site-settings/site-settings-service";

/**
 * Граница тела запроса на PUT /api/site-settings.
 *
 * `updateSiteSettingsSchema` — единственная схема тела в проекте, у которой все
 * поля необязательные, то есть `{}` для неё валиден. А `updateSettings` пишет
 * полный снимок переопределений. Значит, подмена нечитаемого тела на пустой
 * объект (частый в проекте приём `.catch(() => ({}))`) означала бы: телефон,
 * почта и счётчик Метрики стёрты, блокировка по версии пропущена, ответ 200 OK.
 * Наружу это выглядит как успешное сохранение.
 */

const adminSession = {
  id: "s1",
  userId: "u1",
  lastSeenAt: new Date(),
  expiresAt: new Date(Date.now() + 3600_000),
  user: {
    id: "u1",
    email: "admin@noesis.ru",
    role: "admin",
    isActive: true,
    mustChangePassword: false,
  },
};

/** Runtime с singleton-строкой настроек; запоминает записи. */
function runtimeWithSettings(initial: Record<string, unknown>) {
  const row = {
    id: SITE_SETTINGS_ID,
    data: initial as unknown,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const writes: unknown[] = [];
  const rt = {
    env: {
      CORS_ORIGINS: ["http://localhost:5173"],
      COOKIE_SECURE: false,
      SESSION_TTL_HOURS: 12,
    },
    prisma: {
      session: {
        findUnique: async () => adminSession,
        update: async () => ({}),
      },
      // Флажок пересборки ставит middleware после успешной мутации; он
      // fail-safe, но без заглушки сорит стеком в вывод теста.
      siteBuild: {
        upsert: async () => ({ id: "b1", status: "idle", contentChangedAt: null }),
        update: async () => ({}),
        findUnique: async () => null,
      },
      siteSettings: {
        findUnique: async () => row,
        upsert: async () => row,
        update: async ({ data }: any) => {
          writes.push(data.data);
          row.data = data.data;
          return row;
        },
      },
    },
  } as unknown as Runtime;
  return { rt, row, writes };
}

function putSettings(rt: Runtime, body?: string) {
  return createApp(rt).request("/api/site-settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5173",
      Cookie: "noesis_session=token-abc",
    },
    ...(body === undefined ? {} : { body }),
  });
}

describe("PUT /api/site-settings: тело запроса", () => {
  test("пустое тело не стирает настройки и не отвечает успехом", async () => {
    const { rt, row, writes } = runtimeWithSettings({ phonePrimary: "+79280009300" });

    const res = await putSettings(rt);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_json" } });
    // Главное: до записи дело не дошло, настройки на месте.
    expect(writes).toHaveLength(0);
    expect(row.data).toEqual({ phonePrimary: "+79280009300" });
  });

  test("битый JSON не стирает настройки", async () => {
    const { rt, row, writes } = runtimeWithSettings({ phonePrimary: "+79280009300" });

    const res = await putSettings(rt, "{не json");

    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
    expect(row.data).toEqual({ phonePrimary: "+79280009300" });
  });

  test("корректное тело сохраняется", async () => {
    const { rt, writes } = runtimeWithSettings({ phonePrimary: "+79280009300" });

    const res = await putSettings(rt, JSON.stringify({ phonePrimary: "+79999999999" }));

    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ phonePrimary: "+79999999999" });
  });
});
