import { z } from "zod";
import { paginationQuerySchema, SLUG_RE } from "./common";
import { assetSchema, IMAGE_MAX_BYTES } from "./file";
import { developerSchema, publicDeveloperSchema } from "./developer";

// --- Справочные значения и константы ---

/** Статус публикации конструкции. Черновик виден только в CRM. */
export const constructionStatusSchema = z.enum(["draft", "published"]);
export type ConstructionStatus = z.infer<typeof constructionStatusSchema>;

/**
 * Формат рекламной конструкции. Структурно ради фильтров каталога/карты.
 * Основной продукт компании — сити-форматы; остальное на вырост.
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

/** Код продаваемой стороны конструкции. */
export const constructionSideSchema = z.enum(["A", "B", "C"]);
export type ConstructionSide = z.infer<typeof constructionSideSchema>;
export const CONSTRUCTION_SIDE_CODES = ["A", "B", "C"] as const satisfies readonly ConstructionSide[];

/** Количество продаваемых сторон конструкции. */
export const constructionSideCountSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type ConstructionSideCount = z.infer<typeof constructionSideCountSchema>;

export const CONSTRUCTION_SIDE_COUNT_LABEL: Record<ConstructionSideCount, string> = {
  1: "Односторонняя",
  2: "Двусторонняя (A/B)",
  3: "Трёхсторонняя (A/B/C)",
};

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

// --- Бейджи карточки (палитра — единый источник для CRM-пикера и лендинга) ---

/**
 * Палитра бейджей. Цвета из фирменных CSS-переменных; форма бейджа повторяет
 * `.badge-soon`. `bg` — фон, `fg` — контрастный текст.
 */
export const BADGE_PALETTE = {
  blue: { label: "Красный", bg: "#A4161A", fg: "#ffffff" },
  graphite: { label: "Графит", bg: "#262C35", fg: "#ffffff" },
  gray: { label: "Серый", bg: "#54555E", fg: "#ffffff" },
  light: { label: "Светло-красный", bg: "#D46A6A", fg: "#3a0d12" },
  soft: { label: "Розовый", bg: "#FBEAEA", fg: "#A4161A" },
} as const;
export type BadgeColor = keyof typeof BADGE_PALETTE;

/** Цвет бейджа — только токен из палитры (не произвольная CSS-строка). */
export const badgeColorSchema = z.enum([
  "blue",
  "graphite",
  "gray",
  "light",
  "soft",
]);

/** Максимум символов в тексте бейджа (чтобы не ломать карточку). */
export const MAX_BADGE_TEXT = 24;
/** Разумный потолок числа бейджей на карточке. */
export const MAX_BADGES = 20;
/**
 * Мягкий предел фото в галерее: каждое фото обрабатывается синхронно (оригинал +
 * 3 WebP), большая галерея за одно сохранение упёрлась бы в таймаут на VPS.
 */
export const MAX_GALLERY_IMAGES = 30;

/**
 * Верхняя граница тела запроса сохранения конструкции (multipart с данными +
 * новыми фото) для раннего отказа до буферизации в память: вся галерея по
 * максимуму.
 */
export const CONSTRUCTION_UPLOAD_MAX_BYTES =
  MAX_GALLERY_IMAGES * IMAGE_MAX_BYTES + 2 * 1024 * 1024;

/** Один бейдж: текст + цвет из палитры. */
export const badgeSchema = z.object({
  text: z.string().trim().min(1, "Текст бейджа пуст").max(MAX_BADGE_TEXT),
  color: badgeColorSchema,
});
export type Badge = z.infer<typeof badgeSchema>;

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

/** Продаваемая сторона конструкции. `pricePerMonth=null` означает наследовать цену конструкции. */
export const constructionSideDetailsSchema = z.object({
  id: z.string(),
  code: constructionSideSchema,
  /** Направление/описание стороны для менеджера и публичной карточки. */
  description: z.string().nullable(),
  /** Переопределение цены стороны; `null` → дефолт конструкции. */
  pricePerMonth: z.number().int().nullable(),
  /** Итоговая цена стороны с учётом дефолта конструкции. */
  effectivePricePerMonth: z.number().int().nullable(),
  priceLabel: z.string(),
  trafficPerDay: z.number().int().nullable(),
  grp: z.number().nullable(),
  photo: assetSchema.optional(),
});
export type ConstructionSideDetails = z.infer<typeof constructionSideDetailsSchema>;

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
  /** Количество продаваемых сторон. Сама сторона выбирается в брони. */
  sideCount: constructionSideCountSchema,
  /** Реальные продаваемые стороны A/B/C. */
  sides: z.array(constructionSideDetailsSchema),
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

/**
 * Карточка конструкции для анонимных `/api/public/constructions*`. Отличается
 * от CRM-варианта только владельцем: наружу уходит `publicDeveloperSchema`
 * без договорных реквизитов. Лендинг типизируется именно этой схемой, чтобы
 * реквизиты нельзя было прочитать даже случайно.
 */
export const publicConstructionSchema = constructionSchema.extend({
  owner: publicDeveloperSchema.optional(),
});
export type PublicConstruction = z.infer<typeof publicConstructionSchema>;

// --- Вход на создание/обновление (multipart: `data` + файлы `image_N`) ---

/**
 * Элемент итоговой галереи при сохранении: оставить уже загруженное фото
 * (`existing`) или привязать новый файл из multipart по индексу (`new`).
 * Сохранение — полный снимок: клиент присылает весь желаемый состав, бэкенд
 * догружает новое и удаляет убранное.
 */
export const constructionImageInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), assetId: z.string() }),
  z.object({
    kind: z.literal("new"),
    uploadIndex: z.number().int().nonnegative(),
  }),
]);
export type ConstructionImageInput = z.infer<
  typeof constructionImageInputSchema
>;

export const constructionSideInputSchema = z.object({
  code: constructionSideSchema,
  description: z.string().trim().max(500).nullable().optional(),
  pricePerMonth: z
    .number()
    .int()
    .positive("Цена должна быть больше 0")
    .nullable()
    .optional(),
  trafficPerDay: z.number().int().nonnegative().nullable().optional(),
  grp: z.number().nonnegative().nullable().optional(),
  /** Индекс фото в итоговом массиве `images`; `null` — без отдельного фото стороны. */
  photoIndex: z.number().int().nonnegative().nullable().optional(),
});
export type ConstructionSideInput = z.infer<typeof constructionSideInputSchema>;

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
    // Формат/подсветка с дефолтами: черновику достаточно названия, форма всегда
    // шлёт их явно. Основной продукт — сити-формат, подсветка по умолчанию нет.
    format: constructionFormatSchema.default("cityFormat"),
    size: z.string().trim().max(MAX_CONSTRUCTION_SIZE).optional(),
    sideCount: constructionSideCountSchema.default(1),
    sides: z.array(constructionSideInputSchema).max(3).optional(),
    lighting: constructionLightingSchema.default("none"),
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

    const activeCodes = CONSTRUCTION_SIDE_CODES.slice(0, v.sideCount);
    const seenCodes = new Set<ConstructionSide>();
    for (const [index, side] of (v.sides ?? []).entries()) {
      if (!activeCodes.includes(side.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sides", index, "code"],
          message: "Сторона не входит в выбранное количество сторон",
        });
      }
      if (seenCodes.has(side.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sides", index, "code"],
          message: "Сторона указана дважды",
        });
      }
      seenCodes.add(side.code);
      if (
        side.photoIndex != null &&
        (side.photoIndex < 0 || side.photoIndex >= images.length)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sides", index, "photoIndex"],
          message: "Фото стороны вне набора фото",
        });
      }
    }

    if (v.status !== "published") return; // черновик — достаточно названия

    // Обычная публикация — строгий набор (решение по обязательным полям).
    // Цена может быть неизвестна: публичный DTO покажет «Цена по запросу».
    if (!v.address) issue("address", "Укажите адрес");
    if (!hasLat || !hasLng) issue("lat", "Проставьте точку на карте");
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
