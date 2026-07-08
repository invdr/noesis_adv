import { z } from "zod";
import { paginationQuerySchema } from "./common";
import { assetSchema } from "./file";
import { developerSchema } from "./developer";
// Переиспользуем домен-независимые примитивы из унаследованного каталога ЖК
// (tower-site). При выводе `Project` из обихода (Этап 1) эти хелперы стоит
// вынести в общий модуль — сейчас берём их как есть, чтобы не дублировать.
import {
  SLUG_RE,
  badgeSchema,
  MAX_BADGES,
  projectImageInputSchema,
  MAX_GALLERY_IMAGES,
} from "./project";

// --- Справочные значения и константы ---

/** Статус публикации конструкции. Черновик виден только в CRM. */
export const constructionStatusSchema = z.enum(["draft", "published"]);
export type ConstructionStatus = z.infer<typeof constructionStatusSchema>;

/**
 * Формат рекламной конструкции. Структурно ради фильтров каталога/карты.
 * Основной продукт агентства — сити-форматы; остальное на вырост.
 */
export const constructionFormatSchema = z.enum([
  "cityFormat", // сити-формат (осн. продукт, ~1,2 × 1,8 м)
  "billboard", // щит 3 × 6
  "superSite", // суперсайт
  "pillar", // пилон / стела
  "mediaScreen", // медиаэкран (цифровой)
  "other",
]);
export type ConstructionFormat = z.infer<typeof constructionFormatSchema>;

/** Подписи форматов для CRM-формы и фильтров лендинга. */
export const CONSTRUCTION_FORMAT_LABEL: Record<ConstructionFormat, string> = {
  cityFormat: "Сити-формат",
  billboard: "Щит 3 × 6",
  superSite: "Суперсайт",
  pillar: "Пилон / стела",
  mediaScreen: "Медиаэкран",
  other: "Другое",
};

/**
 * Сторона конструкции. Двусторонние конструкции продаются по сторонам;
 * `null` — односторонняя / сторона не применима. Гранулярность брони по
 * сторонам решается на Этапе 2 (инвентарь).
 */
export const constructionSideSchema = z.enum(["A", "B"]);
export type ConstructionSide = z.infer<typeof constructionSideSchema>;

/** Подсветка конструкции. */
export const constructionLightingSchema = z.enum([
  "none", // без подсветки
  "internal", // внутренняя (задняя) подсветка
  "external", // внешняя (прожекторы)
]);
export type ConstructionLighting = z.infer<typeof constructionLightingSchema>;

/** Подписи подсветки для CRM-формы. */
export const CONSTRUCTION_LIGHTING_LABEL: Record<ConstructionLighting, string> =
  {
    none: "Без подсветки",
    internal: "Внутренняя",
    external: "Внешняя",
  };

/** Инвентарный код: короткий человеко-понятный идентификатор («СФ-014»). */
export const MAX_CONSTRUCTION_CODE = 40;
/** Габариты как свободная подпись («1,2 × 1,8 м») — форматы разнятся. */
export const MAX_CONSTRUCTION_SIZE = 60;

// --- Хелперы вывода (чистые, переиспользуются бэком, CRM и лендингом) ---

const RUB = new Intl.NumberFormat("ru-RU");

/**
 * Цена за месяц (рубли, целое) → подпись «45 000 ₽/мес». `null` → «Цена по
 * запросу». Единица периода в каталоге — календарный месяц (наружка продаётся
 * помесячно); суточные/недельные пакеты — на вырост в брони (Этап 2).
 */
export function pricePerMonthLabel(pricePerMonth: number | null): string {
  if (pricePerMonth == null) return "Цена по запросу";
  return `${RUB.format(pricePerMonth)} ₽/мес`;
}

// --- DTO, который отдаёт API ---

/**
 * Карточка конструкции. Используется и в CRM, и на лендинге (у изображений в
 * `cover`/`images` есть `renditions` под `srcset`). `priceLabel` — готовая
 * строка для вывода, `pricePerMonth` — структурное значение.
 */
export const constructionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  /** Инвентарный код («СФ-014»); `null` — не задан. */
  code: z.string().nullable(),
  /** Владелец сети (унаследованная сущность Developer). */
  owner: developerSchema.optional(),
  address: z.string().nullable(),
  /** Район города — для фильтров каталога. */
  district: z.string().nullable(),
  /** Гео-координаты для карты (Этап 3); `null` — не проставлены. */
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  format: constructionFormatSchema,
  /** Габариты свободной строкой («1,2 × 1,8 м»). */
  size: z.string().nullable(),
  /** Сторона (для двусторонних); `null` — односторонняя. */
  side: constructionSideSchema.nullable(),
  lighting: constructionLightingSchema,
  /** Рейтинг GRP (охват), если известен. */
  grp: z.number().nullable(),
  /** Суточный трафик (пассажиро-/автопоток), если известен. */
  trafficPerDay: z.number().int().nullable(),
  /** Цена за месяц в рублях; `null` → «Цена по запросу». */
  pricePerMonth: z.number().int().nullable(),
  /** Готовая подпись цены для вывода. */
  priceLabel: z.string(),
  description: z.string().nullable(),
  /** Обложка — одно из фото галереи. */
  cover: assetSchema.optional(),
  /** Галерея по порядку (включая обложку). */
  images: z.array(assetSchema),
  badges: z.array(badgeSchema),
  status: constructionStatusSchema,
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Construction = z.infer<typeof constructionSchema>;

// --- Вход на создание/обновление (multipart: `data` + файлы `image_N`) ---

/**
 * Элемент галереи при сохранении: оставить загруженное фото (`existing`) или
 * привязать новый файл из multipart по индексу (`new`). Тот же снимок-паттерн,
 * что у каталога ЖК (переиспользуем `projectImageInputSchema`).
 */
export const constructionImageInputSchema = projectImageInputSchema;
export type ConstructionImageInput = z.infer<
  typeof constructionImageInputSchema
>;

/**
 * Данные сохранения конструкции. Обязательность зависит от статуса: черновик —
 * только название; публикация — строгий набор (адрес, гео, цена, фото).
 * Перекрёстные правила — в `superRefine`, чтобы ошибки шли по полям формы.
 */
export const upsertConstructionSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название").max(160),
    /** Ручная правка URL; если не задан при создании — генерируется из имени. */
    slug: z
      .string()
      .trim()
      .regex(SLUG_RE, "Адрес: латиница, цифры и дефис")
      .max(160)
      .optional(),
    code: z.string().trim().max(MAX_CONSTRUCTION_CODE).optional(),
    ownerId: z.string().optional(),
    address: z.string().trim().max(240).optional(),
    district: z.string().trim().max(120).optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    format: constructionFormatSchema,
    size: z.string().trim().max(MAX_CONSTRUCTION_SIZE).optional(),
    side: constructionSideSchema.nullable().optional(),
    lighting: constructionLightingSchema,
    grp: z.number().nonnegative().nullable().optional(),
    trafficPerDay: z.number().int().nonnegative().nullable().optional(),
    pricePerMonth: z
      .number()
      .int()
      .positive("Цена должна быть больше 0")
      .nullable()
      .optional(),
    description: z.string().trim().max(20000).optional(),
    badges: z.array(badgeSchema).max(MAX_BADGES).optional(),
    status: constructionStatusSchema,
    images: z
      .array(constructionImageInputSchema)
      .max(MAX_GALLERY_IMAGES, "Слишком много фото")
      .optional(),
    /** Индекс обложки в массиве `images`. */
    coverIndex: z.number().int().nonnegative().optional(),
    /** Метка версии (`updatedAt`), на которой открыли карточку — для блокировки. */
    expectedUpdatedAt: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const images = v.images ?? [];
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (
      v.coverIndex !== undefined &&
      (v.coverIndex < 0 || v.coverIndex >= images.length)
    ) {
      issue("coverIndex", "Обложка вне набора фото");
    }
    const hasCover =
      images.length > 0 &&
      v.coverIndex !== undefined &&
      v.coverIndex < images.length;

    // Гео-координаты задаём/сбрасываем только парой.
    const hasLat = v.lat != null;
    const hasLng = v.lng != null;
    if (hasLat !== hasLng) {
      issue("lng", "Укажите обе координаты (широту и долготу)");
    }

    if (v.status !== "published") return; // черновик — достаточно названия

    // Обычная публикация — строгий набор (решение по обязательным полям).
    if (!v.address) issue("address", "Укажите адрес");
    if (!hasLat || !hasLng) issue("lat", "Проставьте точку на карте");
    if (v.pricePerMonth == null) issue("pricePerMonth", "Укажите цену за месяц");
    if (images.length === 0) issue("images", "Добавьте хотя бы одно фото");
    if (!hasCover) issue("coverIndex", "Отметьте обложку");
  });
export type UpsertConstructionInput = z.infer<typeof upsertConstructionSchema>;

/** Параметры списка конструкций в CRM (фильтры + пагинация). */
export const listConstructionsQuerySchema = paginationQuerySchema.extend({
  status: constructionStatusSchema.optional(),
  format: constructionFormatSchema.optional(),
  search: z.string().trim().max(120).optional(),
});
export type ListConstructionsQuery = z.infer<
  typeof listConstructionsQuerySchema
>;
