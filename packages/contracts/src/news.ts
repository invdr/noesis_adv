import { z } from "zod";
import { paginationQuerySchema } from "./common";
import { assetSchema } from "./file";
import { SLUG_RE } from "./project";

// --- Метки новостей (управляемый справочник, ведёт admin) ---

/**
 * DTO метки/категории новости. На лендинге метки рендерятся единым стилем
 * (одна mono-плашка), поэтому цвет не храним — только название и порядок.
 */
export const newsLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  /** Позиция в списке (меньше — раньше). */
  order: z.number().int(),
  /** Архивная метка скрыта из выбора; новости с ней сохранены. */
  isArchived: z.boolean(),
});
export type NewsLabel = z.infer<typeof newsLabelSchema>;

/** Создание/переименование метки (admin). slug и порядок назначает сервис. */
export const upsertNewsLabelSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(40),
});
export type UpsertNewsLabelInput = z.infer<typeof upsertNewsLabelSchema>;

/** Новый порядок меток — полный список id в нужной последовательности. */
export const reorderNewsLabelsSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderNewsLabelsInput = z.infer<typeof reorderNewsLabelsSchema>;

// --- Новость ---

/** Статус публикации новости. Черновик виден только в CRM. */
export const newsStatusSchema = z.enum(["draft", "published"]);
export type NewsStatus = z.infer<typeof newsStatusSchema>;

/** Максимум символов в кратком описании карточки каталога. */
export const NEWS_EXCERPT_MAX = 400;
/** Максимум символов в теле статьи. */
export const NEWS_BODY_MAX = 50000;

/**
 * Тело статьи хранится как простой текст; абзацы разделяются пустой строкой.
 * Хелпер разбивает его на абзацы для рендера 1:1 с дизайном (`body[] → <p>`).
 */
export function newsBodyToParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * DTO новости. Используется и в CRM, и на лендинге (у обложки есть `renditions`
 * под `srcset`). `excerpt` — краткое описание для карточки каталога, `body` —
 * полный текст статьи (абзацы — через пустую строку, см. `newsBodyToParagraphs`).
 */
export const newsSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  label: newsLabelSchema.optional(),
  /** Дата публикации (редактируемая, по умолчанию — день создания). */
  date: z.string(),
  excerpt: z.string().nullable(),
  body: z.string(),
  cover: assetSchema.optional(),
  status: newsStatusSchema,
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type News = z.infer<typeof newsSchema>;

/**
 * Данные сохранения новости (multipart: `data` + необязательный файл `cover`).
 * Обязательность зависит от статуса: черновик — только заголовок; для публикации
 * нужны метка, текст и обложка. Дата при отсутствии — сегодняшняя (ставит
 * сервис). Наличие обложки проверяет сервис (схема файла не видит); остальные
 * перекрёстные правила — в `superRefine`, чтобы ошибки приходили по полям формы.
 */
export const upsertNewsSchema = z
  .object({
    title: z.string().trim().min(1, "Укажите заголовок").max(200),
    /** Ручная правка адреса; если не задан при создании — генерируется из заголовка. */
    slug: z
      .string()
      .trim()
      .regex(SLUG_RE, "Адрес: латиница, цифры и дефис")
      .max(200)
      .optional(),
    labelId: z.string().nullable().optional(),
    /** ISO-дата; если не задана — сервис ставит сегодняшнюю. */
    date: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "Некорректная дата")
      .optional(),
    excerpt: z.string().trim().max(NEWS_EXCERPT_MAX).optional(),
    body: z.string().trim().max(NEWS_BODY_MAX).optional(),
    status: newsStatusSchema,
    /** Снять текущую обложку (без загрузки новой). */
    removeCover: z.boolean().optional(),
    /** Метка версии (`updatedAt`), на которой открыли карточку — для блокировки. */
    expectedUpdatedAt: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status !== "published") return; // черновику достаточно заголовка
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!v.labelId) issue("labelId", "Выберите метку");
    if (!v.body) issue("body", "Добавьте текст статьи");
    // Обложка обязательна для публикации — наличие (новый файл или уже
    // загруженная) проверяет сервис: схема файла этого не видит.
  });
export type UpsertNewsInput = z.infer<typeof upsertNewsSchema>;

/** Параметры списка новостей в CRM (фильтры + пагинация). */
export const listNewsQuerySchema = paginationQuerySchema.extend({
  status: newsStatusSchema.optional(),
  labelId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});
export type ListNewsQuery = z.infer<typeof listNewsQuerySchema>;
