import { z } from "zod";
import { paginationQuerySchema } from "./common";
import { assetSchema, IMAGE_MAX_BYTES } from "./file";
import { developerSchema } from "./developer";

// --- Справочные значения и константы ---

/** Статус публикации ЖК. Черновик виден только в CRM. */
export const projectStatusSchema = z.enum(["draft", "published"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** Формат квартиры (комнатность). Храним структурно ради будущих фильтров. */
export const roomFormatSchema = z.enum([
  "studio",
  "one",
  "two",
  "three",
  "fourPlus",
]);
export type RoomFormat = z.infer<typeof roomFormatSchema>;

/** Подписи форматов для CRM-формы. */
export const ROOM_FORMAT_LABEL: Record<RoomFormat, string> = {
  studio: "Студии",
  one: "1-комнатные",
  two: "2-комнатные",
  three: "3-комнатные",
  fourPlus: "4+ комнатные",
};

/**
 * Палитра бейджей — единый источник для CRM-пикера и рендера на лендинге.
 * Цвета взяты из фирменных CSS-переменных дизайна; форма бейджа повторяет
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
 * Верхняя граница тела запроса сохранения ЖК (multipart с данными + новыми
 * фото) для раннего отказа до буферизации в память: вся галерея по максимуму.
 */
export const PROJECT_UPLOAD_MAX_BYTES =
  MAX_GALLERY_IMAGES * IMAGE_MAX_BYTES + 2 * 1024 * 1024;

/** Один бейдж: текст + цвет из палитры. */
export const badgeSchema = z.object({
  text: z.string().trim().min(1, "Текст бейджа пуст").max(MAX_BADGE_TEXT),
  color: badgeColorSchema,
});
export type Badge = z.infer<typeof badgeSchema>;

/** Допустимый формат slug. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// --- Хелперы (чистые, переиспользуются бэком, CRM и лендингом) ---

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

/**
 * slug из произвольного названия: транслит рус→лат, нижний регистр, лишнее —
 * в дефисы. Может вернуть пустую строку (например, из одних символов) — тогда
 * вызывающая сторона подставляет запасной slug.
 */
export function slugify(input: string): string {
  let out = "";
  for (const ch of input.toLowerCase()) out += TRANSLIT[ch] ?? ch;
  return out
    .normalize("NFKD")
    .toLowerCase() // нормализация может вернуть заглавные (напр. № → "No")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const NUMERIC_ORDER: RoomFormat[] = ["one", "two", "three", "fourPlus"];
const NUMERIC_LABEL: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  fourPlus: "4+",
};

/** Короткие подписи форматов для карточек лендинга («Ст», «1к» …). */
const ROOM_SHORT_LABEL: Record<RoomFormat, string> = {
  studio: "Ст",
  one: "1к",
  two: "2к",
  three: "3к",
  fourPlus: "4к+",
};

/**
 * Короткая комнатность для каталога лендинга 1:1 («Ст, 1к, 2к, 3к»). В отличие
 * от `roomsToLabel` (длинная форма для CRM), эта строка повторяет вёрстку
 * исходного дизайна карточки ЖК. Пустой набор → пустая строка (вызывающая
 * сторона подставляет «Уточняйте»).
 */
export function roomsToShortLabel(rooms: RoomFormat[]): string {
  const order: RoomFormat[] = ["studio", "one", "two", "three", "fourPlus"];
  return order
    .filter((r) => rooms.includes(r))
    .map((r) => ROOM_SHORT_LABEL[r])
    .join(", ");
}

/**
 * Цена «от» (рубли, целое) → подпись лендинга «от 3,7 млн ₽» (десятые доли —
 * через запятую, целые — без дробной части). `null` → «Цена по запросу» 1:1 с
 * исходным дизайном.
 */
export function priceFromLabel(priceFrom: number | null): string {
  if (priceFrom == null) return "Цена по запросу";
  const mln = Math.round((priceFrom / 1_000_000) * 10) / 10;
  const text = (Number.isInteger(mln) ? String(mln) : mln.toFixed(1)).replace(
    ".",
    ",",
  );
  return `от ${text} млн ₽`;
}

/**
 * Структурную комнатность собираем в строку для вывода на лендинге 1:1
 * («Студии, 1–3 комнатные»). Непрерывный ряд показываем диапазоном.
 */
export function roomsToLabel(rooms: RoomFormat[]): string {
  const parts: string[] = [];
  if (rooms.includes("studio")) parts.push("Студии");

  const present = NUMERIC_ORDER.filter((r) => rooms.includes(r));
  if (present.length === 1) {
    const l = NUMERIC_LABEL[present[0]!]!;
    // «4+» не склеиваем дефисом: «4+ комнатные», но «2-комнатные».
    parts.push(l.endsWith("+") ? `${l} комнатные` : `${l}-комнатные`);
  } else if (present.length > 1) {
    const idx = present.map((r) => NUMERIC_ORDER.indexOf(r));
    const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
    const core = contiguous
      ? `${NUMERIC_LABEL[present[0]!]}–${NUMERIC_LABEL[present[present.length - 1]!]}`
      : present.map((r) => NUMERIC_LABEL[r]).join(", ");
    parts.push(`${core} комнатные`);
  }
  return parts.join(", ");
}

// --- Инструменты «Выбор квартиры» (шахматка / планировки / 3D-тур) ---

/** Ссылка инструмента: только внешний http(s)-URL. */
const toolUrlSchema = z
  .string()
  .trim()
  .max(500, "Слишком длинная ссылка")
  .regex(/^https?:\/\//i, "Ссылка должна начинаться с http:// или https://");

/**
 * Ссылки инструментов ЖК. Настраиваются в карточке каждого ЖК (продуктовое
 * решение июля 2026 — вместо глобальных флагов сайта): карточка инструмента
 * показывается на лендинге только при заполненной ссылке — «мёртвых» карточек
 * с `href="#"` не бывает. `null` — инструмент выключен.
 */
export const projectToolsSchema = z.object({
  chessboardUrl: toolUrlSchema.nullable(),
  plansUrl: toolUrlSchema.nullable(),
  tour3dUrl: toolUrlSchema.nullable(),
});
export type ProjectTools = z.infer<typeof projectToolsSchema>;

/** Все инструменты выключены (дефолт нового ЖК и legacy-строк). */
export const EMPTY_PROJECT_TOOLS: ProjectTools = {
  chessboardUrl: null,
  plansUrl: null,
  tour3dUrl: null,
};

/** Безопасный разбор JSON-колонки `Project.tools` (legacy `{}` → всё выключено). */
export function normalizeProjectTools(value: unknown): ProjectTools {
  const res = projectToolsSchema.partial().safeParse(value ?? {});
  const v = res.success ? res.data : {};
  return {
    chessboardUrl: v.chessboardUrl ?? null,
    plansUrl: v.plansUrl ?? null,
    tour3dUrl: v.tour3dUrl ?? null,
  };
}

// --- DTO, который отдаёт API ---

/**
 * Карточка ЖК. Используется и в CRM, и на лендинге (у изображений в `cover`/
 * `images` есть `renditions` под `srcset`). `roomsLabel` — готовая строка для
 * вывода, `rooms` — структурные данные.
 */
export const projectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  developer: developerSchema.optional(),
  /** Цена «от» в рублях; `null` → на сайте «Цена по запросу». */
  priceFrom: z.number().int().nullable(),
  rooms: z.array(roomFormatSchema),
  roomsLabel: z.string(),
  description: z.string().nullable(),
  /** Обложка — одно из фото галереи. */
  cover: assetSchema.optional(),
  /** Галерея по порядку (включая обложку). */
  images: z.array(assetSchema),
  badges: z.array(badgeSchema),
  /** Ссылки инструментов «Выбор квартиры» (пустые = карточки скрыты). */
  tools: projectToolsSchema,
  status: projectStatusSchema,
  /** Анонс: показывается тизер-карточкой без отдельной страницы. */
  comingSoon: z.boolean(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

// --- Вход на создание/обновление (multipart: `data` + файлы `image_N`) ---

/**
 * Элемент итоговой галереи при сохранении: либо оставить уже загруженное фото
 * (`existing`), либо привязать новый файл из multipart по индексу (`new`).
 * Сохранение — полный снимок: клиент присылает весь желаемый состав, бэкенд
 * догружает новое и удаляет убранное.
 */
export const projectImageInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), assetId: z.string() }),
  z.object({ kind: z.literal("new"), uploadIndex: z.number().int().nonnegative() }),
]);
export type ProjectImageInput = z.infer<typeof projectImageInputSchema>;

/**
 * Данные сохранения ЖК. Обязательность полей зависит от состояния:
 * черновик — только название; «скоро» (опубликован + `comingSoon`) — название +
 * обложка; обычная публикация — полный набор. Перекрёстные правила — в
 * `superRefine`, чтобы ошибки приходили по конкретным полям формы.
 */
export const upsertProjectSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название").max(160),
    /** Ручная правка адреса; если не задан при создании — генерируется из имени. */
    slug: z.string().trim().regex(SLUG_RE, "Адрес: латиница, цифры и дефис").max(160).optional(),
    address: z.string().trim().max(240).optional(),
    developerId: z.string().optional(),
    priceFrom: z.number().int().positive("Цена должна быть больше 0").nullable().optional(),
    rooms: z.array(roomFormatSchema).optional(),
    description: z.string().trim().max(20000).optional(),
    badges: z.array(badgeSchema).max(MAX_BADGES).optional(),
    /** Полный снимок ссылок инструментов (как badges); нет — всё выключено. */
    tools: projectToolsSchema.optional(),
    status: projectStatusSchema,
    comingSoon: z.boolean().optional(),
    images: z.array(projectImageInputSchema).max(MAX_GALLERY_IMAGES, "Слишком много фото").optional(),
    /** Индекс обложки в массиве `images`. */
    coverIndex: z.number().int().nonnegative().optional(),
    /** Метка версии (`updatedAt`), на которой открыли карточку — для блокировки. */
    expectedUpdatedAt: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const images = v.images ?? [];
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (v.coverIndex !== undefined && (v.coverIndex < 0 || v.coverIndex >= images.length)) {
      issue("coverIndex", "Обложка вне набора фото");
    }
    const hasCover =
      images.length > 0 && v.coverIndex !== undefined && v.coverIndex < images.length;

    if (v.status !== "published") return; // черновик — достаточно названия

    if (v.comingSoon) {
      if (!hasCover) issue("images", "Для анонса нужна обложка");
      return;
    }
    // Обычная публикация — строгий набор (решение по обязательным полям).
    if (!v.address) issue("address", "Укажите адрес");
    if (!v.developerId) issue("developerId", "Выберите застройщика");
    if (v.priceFrom == null) issue("priceFrom", "Укажите цену «от»");
    if (!v.rooms || v.rooms.length === 0) issue("rooms", "Выберите комнатность");
    if (!v.description) issue("description", "Добавьте описание");
    if (images.length === 0) issue("images", "Добавьте хотя бы одно фото");
    if (!hasCover) issue("coverIndex", "Отметьте обложку");
  });
export type UpsertProjectInput = z.infer<typeof upsertProjectSchema>;

/** Параметры списка ЖК в CRM (фильтры + пагинация). */
export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: projectStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
