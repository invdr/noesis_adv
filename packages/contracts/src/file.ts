import { z } from "zod";

/**
 * Тип загружаемого файла. Изображения проходят обработку (несколько размеров +
 * WebP под `srcset`); документы сохраняются как есть.
 */
export const assetKindSchema = z.enum(["image", "document"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

/**
 * Допустимые изображения: MIME → расширение на диске. Тип определяется по
 * содержимому (magic bytes) на бэке, а не по расширению имени файла.
 */
export const IMAGE_MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

/**
 * Допустимые документы: `pdf` и офисные форматы OOXML (надёжно опознаются по
 * содержимому). Старые `.doc`/`.xls` (OLE) сюда не входят — добавляются при
 * необходимости отдельно.
 */
export const DOCUMENT_MIME_EXT = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
} as const;

/** Лимит размера изображения — 10 МБ. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Лимит размера документа — 25 МБ. */
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Целевые ширины (px) производных изображений под `srcset`: тумба-превью,
 * каталожное, крупное. Оригинал сохраняется отдельно. Апскейла нет: ширины
 * больше оригинала отбрасываются.
 */
export const IMAGE_VARIANT_WIDTHS = [320, 800, 1600] as const;

/**
 * Верхний предел размера любой загрузки (= лимит документа, самый большой).
 * Используется бэком для раннего отказа по размеру тела запроса — до того, как
 * файл целиком окажется в памяти; точный лимит по типу проверяется отдельно.
 */
export const MAX_UPLOAD_BYTES = DOCUMENT_MAX_BYTES;

/** Допустимые MIME изображений — для клиентской валидации и атрибута `accept`. */
export const ALLOWED_IMAGE_MIMES = Object.keys(
  IMAGE_MIME_EXT,
) as (keyof typeof IMAGE_MIME_EXT)[];

/** Допустимые MIME документов. */
export const ALLOWED_DOCUMENT_MIMES = Object.keys(
  DOCUMENT_MIME_EXT,
) as (keyof typeof DOCUMENT_MIME_EXT)[];

/** Готовая строка для атрибута `accept` у `<input type="file">`. */
export const UPLOAD_ACCEPT = [
  ...ALLOWED_IMAGE_MIMES,
  ...ALLOWED_DOCUMENT_MIMES,
].join(",");

/** Лимит размера по типу файла (байты) — единый источник для фронта и бэка. */
export function maxBytesForKind(kind: AssetKind): number {
  return kind === "image" ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES;
}

/** Одна производная картинки (WebP) для `srcset`. */
export const imageVariantSchema = z.object({
  width: z.number().int().positive(),
  url: z.string(),
});
export type ImageVariant = z.infer<typeof imageVariantSchema>;

/** Производные изображения: WebP-версии под `srcset` + готовая строка `srcset`. */
export const imageRenditionsSchema = z.object({
  /** WebP-версии разных ширин, по возрастанию. */
  variants: z.array(imageVariantSchema),
  /** Готовая строка для атрибута `srcset` (`url 320w, url 800w, …`). */
  srcset: z.string(),
  /** Самая маленькая версия — превью/тумба. */
  thumbnailUrl: z.string(),
});
export type ImageRenditions = z.infer<typeof imageRenditionsSchema>;

/**
 * DTO загруженного файла, который отдаёт API. Для `image` дополнительно есть
 * `renditions` (производные под `srcset`); у документа их нет.
 */
export const assetSchema = z.object({
  id: z.string(),
  kind: assetKindSchema,
  /** Исходное имя файла — для отображения/скачивания документа. */
  originalName: z.string(),
  mimeType: z.string(),
  /** Размер оригинала в байтах. */
  size: z.number().int().nonnegative(),
  /** Публичная ссылка на оригинал. */
  url: z.string(),
  /** Производные под `srcset`; присутствует только у изображений. */
  renditions: imageRenditionsSchema.optional(),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof assetSchema>;
