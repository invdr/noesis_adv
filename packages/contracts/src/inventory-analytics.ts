import { z } from "zod";
import { addBookingMonths, dateOnlySchema } from "./booking";
import { constructionSideSchema } from "./construction";

/** Потолок окна выборки занятости/аналитики (в т.ч. на публичном эндпоинте). */
export const MAX_ANALYTICS_WINDOW_MONTHS = 24;

export const inventoryAnalyticsQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
  })
  .refine((q) => q.from < q.to, {
    message: "Начало периода должно быть раньше окончания",
    path: ["from"],
  })
  .refine((q) => q.to <= addBookingMonths(q.from, MAX_ANALYTICS_WINDOW_MONTHS), {
    message: `Период не длиннее ${MAX_ANALYTICS_WINDOW_MONTHS} месяцев`,
    path: ["to"],
  });
export type InventoryAnalyticsQuery = z.infer<typeof inventoryAnalyticsQuerySchema>;

export const occupancyStatusSchema = z.enum(["free", "partiallyOccupied", "occupied"]);
export type OccupancyStatus = z.infer<typeof occupancyStatusSchema>;

export const busyIntervalSchema = z.object({
  /** Даты для вывода в UI: обе границы включительно. */
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
});
export type BusyInterval = z.infer<typeof busyIntervalSchema>;

export const inventorySideAnalyticsSchema = z.object({
  sideId: z.string(),
  sideCode: constructionSideSchema,
  sideDescription: z.string().nullable(),
  trafficPerDay: z.number().int().nullable(),
  grp: z.number().nullable(),
  effectivePricePerMonth: z.number().int().nullable(),
  status: occupancyStatusSchema,
  totalDays: z.number().int(),
  occupiedDays: z.number().int(),
  occupancyRate: z.number(),
  plannedRevenue: z.number().int(),
  bookingsCount: z.number().int(),
  bookingsWithoutPrice: z.number().int(),
  busyIntervals: z.array(busyIntervalSchema),
});
export type InventorySideAnalytics = z.infer<typeof inventorySideAnalyticsSchema>;

export const inventoryConstructionAnalyticsSchema = z.object({
  constructionId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  address: z.string().nullable(),
  sides: z.array(inventorySideAnalyticsSchema),
});
export type InventoryConstructionAnalytics = z.infer<
  typeof inventoryConstructionAnalyticsSchema
>;

export const inventoryAnalyticsResponseSchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  totalDays: z.number().int(),
  totalSides: z.number().int(),
  totalSideDays: z.number().int(),
  occupiedSideDays: z.number().int(),
  occupancyRate: z.number(),
  plannedRevenue: z.number().int(),
  freeSides: z.number().int(),
  bookingsCount: z.number().int(),
  bookingsWithoutPrice: z.number().int(),
  constructions: z.array(inventoryConstructionAnalyticsSchema),
});
export type InventoryAnalyticsResponse = z.infer<
  typeof inventoryAnalyticsResponseSchema
>;
