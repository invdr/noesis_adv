import { z } from "zod";

/**
 * УНАСЛЕДОВАННЫЙ модуль публичного лендинга (недвижимость из tower-site).
 *
 * Обслуживает плейсхолдер-сайт, пока он не переведён на каталог конструкций.
 * Удаляется целиком в Этапе 5 (редизайн сайта) — вместе с legacy-роутом
 * `/api/public/projects` и ЖК-типами в `website/`. Ядро CRM их не использует.
 */

/** Формат квартиры (комнатность) — только для старой вёрстки лендинга. */
export const roomFormatSchema = z.enum([
  "studio",
  "one",
  "two",
  "three",
  "fourPlus",
]);
export type RoomFormat = z.infer<typeof roomFormatSchema>;

const ROOM_SHORT_LABEL: Record<RoomFormat, string> = {
  studio: "Ст",
  one: "1к",
  two: "2к",
  three: "3к",
  fourPlus: "4к+",
};

/** Короткая комнатность для карточек старого лендинга («Ст, 1к, 2к, 3к»). */
export function roomsToShortLabel(rooms: RoomFormat[]): string {
  const order: RoomFormat[] = ["studio", "one", "two", "three", "fourPlus"];
  return order
    .filter((r) => rooms.includes(r))
    .map((r) => ROOM_SHORT_LABEL[r])
    .join(", ");
}

/** Цена «от» (рубли) → «от 3,7 млн ₽»; `null` → «Цена по запросу». */
export function priceFromLabel(priceFrom: number | null): string {
  if (priceFrom == null) return "Цена по запросу";
  const mln = Math.round((priceFrom / 1_000_000) * 10) / 10;
  const text = (Number.isInteger(mln) ? String(mln) : mln.toFixed(1)).replace(
    ".",
    ",",
  );
  return `от ${text} млн ₽`;
}

const toolUrlSchema = z
  .string()
  .trim()
  .max(500, "Слишком длинная ссылка")
  .regex(/^https?:\/\//i, "Ссылка должна начинаться с http:// или https://");

/** Ссылки инструментов «Выбор квартиры» старого лендинга. */
export const projectToolsSchema = z.object({
  chessboardUrl: toolUrlSchema.nullable(),
  plansUrl: toolUrlSchema.nullable(),
  tour3dUrl: toolUrlSchema.nullable(),
});
export type ProjectTools = z.infer<typeof projectToolsSchema>;

/** Все инструменты выключены — дефолт для legacy-карточки конструкции. */
export const EMPTY_PROJECT_TOOLS: ProjectTools = {
  chessboardUrl: null,
  plansUrl: null,
  tour3dUrl: null,
};
