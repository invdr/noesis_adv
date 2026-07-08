import { z } from "zod";
import { assetSchema } from "./file";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * Застройщик — справочная сущность (фиксированный список ведёт admin, менеджер
 * лишь выбирает из него при заведении ЖК). У ГСК TOWER их пять, но состав
 * редактируемый. «Удаление» = архивация: на застройщика могут ссылаться ЖК,
 * поэтому из БД его не стираем.
 */
export const developerSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Полное юридическое наименование ООО для будущих договорных документов. */
  legalName: z.string().nullable(),
  inn: z.string().nullable(),
  kpp: z.string().nullable(),
  ogrn: z.string().nullable(),
  legalAddress: z.string().nullable(),
  postalAddress: z.string().nullable(),
  bankName: z.string().nullable(),
  bankBik: z.string().nullable(),
  bankAccount: z.string().nullable(),
  correspondentAccount: z.string().nullable(),
  directorTitle: z.string().nullable(),
  directorFullName: z.string().nullable(),
  directorBasis: z.string().nullable(),
  /** Стабильный человеко-понятный идентификатор (на будущее: фильтры/URL). */
  slug: z.string(),
  /** Логотип (изображение), если загружен. */
  logo: assetSchema.optional(),
  /** Архивный застройщик скрыт из выбора, но сохранён ради ссылок из ЖК. */
  isArchived: z.boolean(),
  /** Позиция в списке (меньше — раньше). */
  order: z.number().int(),
  createdAt: z.string(),
});
export type Developer = z.infer<typeof developerSchema>;

/**
 * Создание/обновление застройщика (admin). Логотип передаётся отдельным файлом
 * в multipart (поле `logo`); `removeLogo` снимает текущий логотип.
 */
export const upsertDeveloperSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(120),
  legalName: optionalText(240),
  inn: optionalText(12),
  kpp: optionalText(9),
  ogrn: optionalText(15),
  legalAddress: optionalText(300),
  postalAddress: optionalText(300),
  bankName: optionalText(200),
  bankBik: optionalText(9),
  bankAccount: optionalText(32),
  correspondentAccount: optionalText(32),
  directorTitle: optionalText(120),
  directorFullName: optionalText(160),
  directorBasis: optionalText(160),
  removeLogo: z.boolean().optional(),
});
export type UpsertDeveloperInput = z.infer<typeof upsertDeveloperSchema>;
