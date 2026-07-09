import { z } from "zod";
import { assetSchema } from "./file";

// --- Категории документов (общий справочник, ведёт admin) ---

/**
 * DTO категории документов. Справочник общий для всех конструкций: на главной
 * навигация идёт от категории к конструкции, поэтому категория — общая ось, а не
 * произвольный список внутри отдельной конструкции.
 */
export const documentCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  /** Позиция в списке (меньше — раньше); задаёт порядок плиток на главной. */
  order: z.number().int(),
  /** Архивная категория скрыта из выбора и с главной; документы сохранены. */
  isArchived: z.boolean(),
});
export type DocumentCategory = z.infer<typeof documentCategorySchema>;

/** Создание/переименование категории (admin). slug и порядок назначает сервис. */
export const upsertDocumentCategorySchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(80),
});
export type UpsertDocumentCategoryInput = z.infer<
  typeof upsertDocumentCategorySchema
>;

/** Новый порядок категорий — полный список id в нужной последовательности. */
export const reorderDocumentCategoriesSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderDocumentCategoriesInput = z.infer<
  typeof reorderDocumentCategoriesSchema
>;

// --- Документ (загруженный файл или внешняя ссылка) ---

/** Вид документа: загруженный файл или внешняя ссылка. */
export const documentKindSchema = z.enum(["file", "link"]);
export type DocumentKind = z.infer<typeof documentKindSchema>;

/** Человекочитаемая метка типа документа по MIME (для мелкой строки карточки). */
export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PPTX",
};

/** Размер файла в человекочитаемом виде с рус. разделителем («1,2 МБ»). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace(".", ",")} КБ`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace(".", ",")} МБ`;
}

/** Мелкая строка карточки документа-файла: «PDF · 1,2 МБ». */
export function documentFileMeta(mimeType: string, size: number): string {
  const type = DOCUMENT_TYPE_LABEL[mimeType] ?? "Файл";
  return `${type} · ${formatFileSize(size)}`;
}

/**
 * DTO документа. Размечен по `kind`: `file` несёт загруженный `Asset` (тип и
 * размер берутся из него), `link` — внешний `url` и ручную подпись `caption`
 * для мелкой строки карточки (тип/размер внешнего файла нам неизвестны).
 */
export const documentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    id: z.string(),
    name: z.string(),
    category: documentCategorySchema.optional(),
    asset: assetSchema,
    createdAt: z.string(),
  }),
  z.object({
    kind: z.literal("link"),
    id: z.string(),
    name: z.string(),
    category: documentCategorySchema.optional(),
    /** Внешняя ссылка; на лендинге открывается в новой вкладке. */
    url: z.string(),
    /** Ручная подпись для мелкой строки карточки. */
    caption: z.string().nullable(),
    createdAt: z.string(),
  }),
]);
export type Document = z.infer<typeof documentSchema>;

/** Только `http(s)`-ссылка (защита href от `javascript:`/`data:`). */
const httpUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .url("Некорректная ссылка")
  .refine(
    (u) => /^https?:\/\//i.test(u),
    "Ссылка должна начинаться с http:// или https://",
  );

/**
 * Добавление документа в карточку конструкции (multipart `data` + для `file` — файл
 * `file`). Для `file` название необязательно: сервис возьмёт имя файла без
 * расширения. Для `link` название обязательно (имени файла нет).
 */
export const createDocumentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    categoryId: z.string(),
    name: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal("link"),
    categoryId: z.string(),
    name: z.string().trim().min(1, "Укажите название").max(200),
    url: httpUrlSchema,
    caption: z.string().trim().max(200).optional(),
  }),
]);
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/**
 * Правка метаданных документа (вид не меняется). Файл/ссылку не перезагружаем:
 * редактируем название, категорию, а для ссылки — адрес и подпись.
 */
export const updateDocumentSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название").max(200).optional(),
    categoryId: z.string().optional(),
    caption: z.string().trim().max(200).nullable().optional(),
    url: httpUrlSchema.optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.categoryId !== undefined ||
      v.caption !== undefined ||
      v.url !== undefined,
    { message: "Нет изменений" },
  );
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

// --- Публичные DTO для лендинга ---

/**
 * Документы одной конструкции, сгруппированные по категории. Группы — в порядке
 * справочника категорий.
 */
export const documentGroupSchema = z.object({
  category: documentCategorySchema,
  documents: z.array(documentSchema),
});
export type DocumentGroup = z.infer<typeof documentGroupSchema>;

/** Облегчённая ссылка на конструкцию для блока документов на главной. */
export const documentConstructionRefSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  cover: assetSchema.optional(),
});
export type DocumentConstructionRef = z.infer<typeof documentConstructionRefSchema>;

/**
 * Категория и конструкции, у которых есть документы этой категории — для
 * навигации «от категории к конструкции» на главной. Пустые категории сюда не попадают.
 */
export const documentCategoryConstructionsSchema = z.object({
  category: documentCategorySchema,
  constructions: z.array(documentConstructionRefSchema),
});
export type DocumentCategoryConstructions = z.infer<
  typeof documentCategoryConstructionsSchema
>;
