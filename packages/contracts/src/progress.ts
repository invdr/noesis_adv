import { z } from "zod";
import { assetSchema, IMAGE_MAX_BYTES } from "./file";

/**
 * Ход строительства: фотоальбом за месяц по ЖК. Управляется в карточке ЖК
 * точечными операциями (как документы, не в снимке «Сохранить ЖК»); на
 * лендинге — секция на странице ЖК от новых месяцев к старым. Один альбом на
 * период (`год+месяц`), пустой альбом (без фото) на лендинг не попадает.
 */

/** DTO альбома хода строительства. Фото — по позиции (порядок добавления). */
export const progressAlbumSchema = z.object({
  id: z.string(),
  year: z.number().int(),
  month: z.number().int(),
  /** Необязательный комментарий к этапу («Смонтированы окна…»). */
  note: z.string().nullable(),
  photos: z.array(assetSchema),
  createdAt: z.string(),
});
export type ProgressAlbum = z.infer<typeof progressAlbumSchema>;

/** Создание/правка альбома: период + необязательный комментарий. */
export const upsertProgressAlbumSchema = z.object({
  year: z
    .number()
    .int()
    .min(2000, "Некорректный год")
    .max(2100, "Некорректный год"),
  month: z.number().int().min(1, "Месяц 1–12").max(12, "Месяц 1–12"),
  note: z.string().trim().max(300, "Не длиннее 300 символов").optional(),
});
export type UpsertProgressAlbumInput = z.infer<typeof upsertProgressAlbumSchema>;

/**
 * Максимум фото в одном запросе загрузки (лимит тела = 10 × лимит изображения).
 * CRM проверяет до отправки, бэк отвечает 422 при превышении — лишние файлы
 * не отбрасываются молча.
 */
export const MAX_PROGRESS_PHOTOS_PER_REQUEST = 10;

/**
 * Верхняя граница тела запроса загрузки фото: полная пачка + запас на
 * multipart-оверхед (как PROJECT_UPLOAD_MAX_BYTES) — иначе формально
 * допустимый набор из 10 файлов по максимуму упрётся в 413.
 */
export const PROGRESS_UPLOAD_MAX_BYTES =
  MAX_PROGRESS_PHOTOS_PER_REQUEST * IMAGE_MAX_BYTES + 2 * 1024 * 1024;

/** Названия месяцев в именительном падеже — подпись периода альбома. */
export const PROGRESS_MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

/** Подпись периода альбома: «Июнь 2026». Некорректный месяц → «6/2026». */
export function progressPeriodLabel(year: number, month: number): string {
  const name = PROGRESS_MONTHS[month - 1];
  return name ? `${name} ${year}` : `${month}/${year}`;
}

/** Сортировка альбомов от новых месяцев к старым (для CRM и лендинга). */
export function compareProgressDesc(
  a: { year: number; month: number },
  b: { year: number; month: number },
): number {
  return b.year - a.year || b.month - a.month;
}
