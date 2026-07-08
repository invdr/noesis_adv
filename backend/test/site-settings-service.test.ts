import { describe, expect, test } from "bun:test";
import { SITE_SETTINGS_DEFAULTS, updateSiteSettingsSchema } from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import { HttpError } from "../src/http/errors";
import {
  SITE_SETTINGS_ID,
  getRawSettings,
  getResolvedSettings,
  updateSettings,
} from "../src/site-settings/site-settings-service";

/**
 * Тесты сервиса настроек «обвязки» (Веха 4.3). БД — in-memory заглушка
 * singleton-строки SiteSettings (движка Prisma в тестах нет): эмулирует ровно
 * upsert/update, что делает сервис.
 */
function makeRuntime(initial?: { data?: unknown; updatedAt?: Date }) {
  const row = {
    id: SITE_SETTINGS_ID,
    data: (initial?.data ?? {}) as unknown,
    updatedAt: initial?.updatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
  };
  const rt = {
    prisma: {
      siteSettings: {
        upsert: async () => ({ ...row }),
        update: async ({ data }: { data: { data: unknown } }) => {
          row.data = data.data;
          row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
          return { ...row };
        },
      },
    },
  } as unknown as Runtime;
  return { rt, row };
}

describe("site-settings-service", () => {
  test("пустая база → resolved равен дефолтам", async () => {
    const { rt } = makeRuntime();
    const resolved = await getResolvedSettings(rt);
    expect(resolved).toEqual(SITE_SETTINGS_DEFAULTS);
  });

  test("сохранение переопределений: храним сырое, resolved мёржит с дефолтами", async () => {
    const { rt, row } = makeRuntime();
    const input = updateSiteSettingsSchema.parse({ navCatalog: "Объекты", newsHomeCount: 6 });
    await updateSettings(rt, input);
    // В БД — только изменённое (разреженно).
    expect(row.data).toEqual({ navCatalog: "Объекты", newsHomeCount: 6 });
    const resolved = await getResolvedSettings(rt);
    expect(resolved.navCatalog).toBe("Объекты");
    expect(resolved.newsHomeCount).toBe(6);
    // Нетронутое — дефолт.
    expect(resolved.navFlats).toBe(SITE_SETTINGS_DEFAULTS.navFlats);
  });

  test("пустая строка очищает переопределение (возврат к дефолту)", async () => {
    const { rt } = makeRuntime({ data: { navCatalog: "Объекты" } });
    const input = updateSiteSettingsSchema.parse({ navCatalog: "" });
    await updateSettings(rt, input);
    const resolved = await getResolvedSettings(rt);
    expect(resolved.navCatalog).toBe(SITE_SETTINGS_DEFAULTS.navCatalog);
  });

  test("телефон нормализуется при сохранении", async () => {
    const { rt, row } = makeRuntime();
    const input = updateSiteSettingsSchema.parse({ phonePrimary: "+7 (999) 123-45-67" });
    await updateSettings(rt, input);
    expect((row.data as { phonePrimary: string }).phonePrimary).toBe("+79991234567");
  });

  test("устаревший expectedUpdatedAt → 409 stale_update", async () => {
    const { rt } = makeRuntime({ updatedAt: new Date("2026-05-05T00:00:00.000Z") });
    const input = updateSiteSettingsSchema.parse({
      navCatalog: "Объекты",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z", // не совпадает
    });
    await expect(updateSettings(rt, input)).rejects.toMatchObject({
      status: 409,
      code: "stale_update",
    });
    expect(updateSettings(rt, input)).rejects.toBeInstanceOf(HttpError);
  });

  test("совпадающий expectedUpdatedAt → сохраняет", async () => {
    const { rt } = makeRuntime({ updatedAt: new Date("2026-05-05T00:00:00.000Z") });
    const input = updateSiteSettingsSchema.parse({
      navCatalog: "Объекты",
      expectedUpdatedAt: "2026-05-05T00:00:00.000Z",
    });
    const out = await updateSettings(rt, input);
    expect(out.settings.navCatalog).toBe("Объекты");
  });

  test("getRawSettings отдаёт сырые переопределения + метку версии", async () => {
    const { rt } = makeRuntime({
      data: { navCatalog: "Объекты" },
      updatedAt: new Date("2026-03-03T00:00:00.000Z"),
    });
    const raw = await getRawSettings(rt);
    expect(raw.settings).toEqual({ navCatalog: "Объекты" });
    expect(raw.updatedAt).toBe("2026-03-03T00:00:00.000Z");
  });

  test("лишние/неизвестные поля в JSON отбрасываются (defensive)", async () => {
    const { rt } = makeRuntime({ data: { navCatalog: "Объекты", legacyField: 123 } });
    const resolved = await getResolvedSettings(rt);
    // Известное валидное поле сохраняется, неизвестное молча отброшено схемой.
    expect(resolved.navCatalog).toBe("Объекты");
    expect((resolved as Record<string, unknown>).legacyField).toBeUndefined();
  });
});
