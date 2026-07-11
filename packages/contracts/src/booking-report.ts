import { z } from "zod";
import { IMAGE_MAX_BYTES } from "./file";
import { dateOnlySchema } from "./booking";

/** Одна фотография закрытого отчёта по размещению. URL доступен только с сессией CRM. */
export const bookingReportPhotoSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  url: z.string(),
});
export type BookingReportPhoto = z.infer<typeof bookingReportPhotoSchema>;

/** Ежемесячный фотоотчёт по конкретной брони. */
export const bookingReportSchema = z.object({
  id: z.string(),
  date: dateOnlySchema,
  note: z.string().nullable(),
  photos: z.array(bookingReportPhotoSchema),
  createdAt: z.string(),
});
export type BookingReport = z.infer<typeof bookingReportSchema>;

/** Создание и правка отчёта: дата задаёт его календарный месяц. */
export const upsertBookingReportSchema = z.object({
  date: dateOnlySchema,
  note: z.string().trim().max(300, "Не длиннее 300 символов").optional(),
});
export type UpsertBookingReportInput = z.infer<typeof upsertBookingReportSchema>;

/** Не больше десяти фото за раз, как в уже существующих фотоальбомах. */
export const MAX_BOOKING_REPORT_PHOTOS_PER_REQUEST = 10;
export const BOOKING_REPORT_UPLOAD_MAX_BYTES =
  MAX_BOOKING_REPORT_PHOTOS_PER_REQUEST * IMAGE_MAX_BYTES + 2 * 1024 * 1024;
