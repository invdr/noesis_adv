import { z } from "zod";
import { paginationQuerySchema } from "./common";
import { constructionSideDetailsSchema, constructionSideSchema } from "./construction";

// --- Справочники бронирования ---

export const bookingBrandSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  isArchived: z.boolean(),
});
export type BookingBrand = z.infer<typeof bookingBrandSchema>;

export const upsertBookingBrandSchema = z.object({
  name: z.string().trim().min(1, "Укажите бренд").max(80),
});
export type UpsertBookingBrandInput = z.infer<typeof upsertBookingBrandSchema>;

export const reorderBookingBrandsSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderBookingBrandsInput = z.infer<
  typeof reorderBookingBrandsSchema
>;

export const bookingServiceReasonSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  isArchived: z.boolean(),
});
export type BookingServiceReason = z.infer<
  typeof bookingServiceReasonSchema
>;

export const upsertBookingServiceReasonSchema = z.object({
  name: z.string().trim().min(1, "Укажите причину").max(80),
});
export type UpsertBookingServiceReasonInput = z.infer<
  typeof upsertBookingServiceReasonSchema
>;

export const reorderBookingServiceReasonsSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderBookingServiceReasonsInput = z.infer<
  typeof reorderBookingServiceReasonsSchema
>;

// --- Бронь ---

export const bookingKindSchema = z.enum(["commercial", "service"]);
export type BookingKind = z.infer<typeof bookingKindSchema>;

export const BOOKING_KIND_LABEL: Record<BookingKind, string> = {
  commercial: "Коммерческая",
  service: "Служебная",
};

export const bookingStatusSchema = z.enum([
  "booked",
  "onAir",
  "completed",
  "cancelled",
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  booked: "Забронировано",
  onAir: "В эфире",
  completed: "Завершено",
  cancelled: "Отменена",
};

export const BOOKING_STATUS_BUSY: Record<BookingStatus, boolean> = {
  booked: true,
  onAir: true,
  completed: true,
  cancelled: false,
};

function isRealDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Дата без времени, реальный календарный день в формате YYYY-MM-DD. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД")
  .refine(isRealDateOnly, "Некорректная календарная дата");

const CONTACT_SUMMARY = z.object({
  id: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  companyName: z.string().nullable(),
});

const USER_SUMMARY = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
});

const LEAD_SUMMARY = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
});

const BOOKING_CONSTRUCTION_SUMMARY = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  address: z.string().nullable(),
  sideCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  pricePerMonth: z.number().int().nullable(),
});

const BOOKING_SIDE_SUMMARY = constructionSideDetailsSchema.pick({
  id: true,
  code: true,
  description: true,
  pricePerMonth: true,
  effectivePricePerMonth: true,
  priceLabel: true,
  trafficPerDay: true,
  grp: true,
});

export const bookingSchema = z.object({
  id: z.string(),
  kind: bookingKindSchema,
  status: bookingStatusSchema,
  construction: BOOKING_CONSTRUCTION_SUMMARY,
  side: BOOKING_SIDE_SUMMARY,
  client: CONTACT_SUMMARY.nullable(),
  serviceReason: bookingServiceReasonSchema.nullable(),
  brand: bookingBrandSchema.nullable(),
  campaignNote: z.string().nullable(),
  lead: LEAD_SUMMARY.nullable(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  durationMonths: z.number().int().positive(),
  basePricePerMonth: z.number().int().nullable(),
  totalPrice: z.number().int().nullable(),
  priceNote: z.string().nullable(),
  reminderAt: dateOnlySchema.nullable(),
  manager: USER_SUMMARY.nullable(),
  createdBy: USER_SUMMARY.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;

/**
 * Данные сохранения брони. `endDate` вычисляет сервис из `startDate` и
 * `durationMonths`, чтобы все поверхности считали плавающий месяц одинаково.
 */
export const upsertBookingSchema = z
  .object({
    kind: bookingKindSchema,
    status: bookingStatusSchema.default("booked"),
    constructionId: z.string().min(1, "Выберите конструкцию"),
    constructionSideId: z.string().min(1).nullable().optional(),
    /** Legacy fallback для старых форм: backend резолвит код в `constructionSideId`. */
    side: constructionSideSchema.nullable().optional(),
    clientId: z.string().min(1).nullable().optional(),
    serviceReasonId: z.string().min(1).nullable().optional(),
    brandId: z.string().min(1).nullable().optional(),
    campaignNote: z.string().trim().max(240).nullable().optional(),
    leadId: z.string().min(1).nullable().optional(),
    startDate: dateOnlySchema,
    durationMonths: z.number().int().min(1).max(60),
    basePricePerMonth: z
      .number()
      .int()
      .positive("Цена должна быть больше 0")
      .nullable()
      .optional(),
    totalPrice: z
      .number()
      .int()
      .nonnegative("Сумма не может быть отрицательной")
      .nullable()
      .optional(),
    priceNote: z.string().trim().max(500).nullable().optional(),
    reminderAt: dateOnlySchema.nullable().optional(),
    managerId: z.string().min(1).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (v.kind === "commercial" && !v.clientId) {
      issue("clientId", "Для коммерческой брони выберите клиента");
    }
    if (v.kind === "service" && !v.serviceReasonId) {
      issue("serviceReasonId", "Для служебной брони выберите причину");
    }
  });
export type UpsertBookingInput = z.infer<typeof upsertBookingSchema>;

export const listBookingsQuerySchema = paginationQuerySchema.extend({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  status: bookingStatusSchema.optional(),
  kind: bookingKindSchema.optional(),
  constructionId: z.string().optional(),
  constructionSideId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

// --- Хелперы дат/периодов ---

function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Прибавить целые месяцы с клампом конца месяца: 31.01 + 1 → 28/29.02. */
export function addBookingMonths(startDate: string, months: number): string {
  const d = parseDateOnly(startDate);
  const zeroMonth = d.month - 1 + months;
  const year = d.year + Math.floor(zeroMonth / 12);
  const month = ((zeroMonth % 12) + 12) % 12;
  const day = Math.min(d.day, daysInMonth(year, month + 1));
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** Дефолтное напоминание — за 7 дней до окончания периода. */
export function defaultBookingReminder(endDate: string, daysBefore = 7): string {
  const d = new Date(`${endDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - daysBefore);
  return d.toISOString().slice(0, 10);
}

export function bookingDefaultTotal(
  basePricePerMonth: number | null,
  durationMonths: number,
): number | null {
  return basePricePerMonth == null ? null : basePricePerMonth * durationMonths;
}
