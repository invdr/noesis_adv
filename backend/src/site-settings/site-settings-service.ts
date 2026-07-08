import type { SiteSettings } from "@prisma/client";
import {
  type ResolvedSiteSettings,
  type SiteSettingsOverrides,
  type UpdateSiteSettingsInput,
  resolveSiteSettings,
  siteSettingsBaseSchema,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";

/** Id единственной строки настроек (singleton). */
export const SITE_SETTINGS_ID = "site";

/** Гарантирует наличие singleton-строки и возвращает её. */
async function ensureRow(rt: Runtime): Promise<SiteSettings> {
  return rt.prisma.siteSettings.upsert({
    where: { id: SITE_SETTINGS_ID },
    create: { id: SITE_SETTINGS_ID },
    update: {},
  });
}

/**
 * Хранимые переопределения из JSON-колонки. Пропускаем через схему (defensive):
 * битые/устаревшие поля игнорируются, остаётся валидный разреженный набор.
 */
function parseOverrides(row: SiteSettings): SiteSettingsOverrides {
  const parsed = siteSettingsBaseSchema.safeParse(row.data ?? {});
  return parsed.success ? parsed.data : {};
}

/** Полный набор настроек (дефолты + переопределения) — для сборки лендинга. */
export async function getResolvedSettings(rt: Runtime): Promise<ResolvedSiteSettings> {
  const row = await ensureRow(rt);
  return resolveSiteSettings(parseOverrides(row));
}

/** Сырые переопределения + метка версии — для формы в CRM (предзаполнение). */
export async function getRawSettings(
  rt: Runtime,
): Promise<{ settings: SiteSettingsOverrides; updatedAt: string }> {
  const row = await ensureRow(rt);
  return { settings: parseOverrides(row), updatedAt: row.updatedAt.toISOString() };
}

/**
 * Сохранение настроек (admin). Оптимистичная блокировка по `expectedUpdatedAt`
 * (как у ЖК/новостей): если кто-то сохранил раньше — 409 `stale_update`. Пустые
 * поля уже отсеяны препроцессом схемы; храним только реально изменённое.
 */
export async function updateSettings(
  rt: Runtime,
  input: UpdateSiteSettingsInput,
): Promise<{ settings: SiteSettingsOverrides; updatedAt: string }> {
  const { expectedUpdatedAt, ...overrides } = input;
  const row = await ensureRow(rt);
  if (expectedUpdatedAt && row.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new HttpError(
      409,
      "stale_update",
      "Настройки изменил другой администратор, обновите страницу",
    );
  }
  const saved = await rt.prisma.siteSettings.update({
    where: { id: SITE_SETTINGS_ID },
    data: { data: overrides },
  });
  return { settings: parseOverrides(saved), updatedAt: saved.updatedAt.toISOString() };
}
