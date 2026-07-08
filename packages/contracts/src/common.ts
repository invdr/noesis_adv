import { z } from "zod";

/** Единая форма ошибки API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Ошибки полей формы: { fieldName: "сообщение" } */
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Параметры постраничной выборки. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Обёртка постраничного ответа. */
export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });

// --- Слаги (человеко-понятные URL) — общий примитив для каталога и новостей ---

/** Допустимый формат slug. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
