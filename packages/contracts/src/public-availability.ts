import { z } from "zod";
import {
  busyIntervalSchema,
  inventoryAnalyticsQuerySchema,
  occupancyStatusSchema,
} from "./inventory-analytics";
import { constructionSideSchema } from "./construction";
import { dateOnlySchema } from "./booking";

export const publicAvailabilityQuerySchema = inventoryAnalyticsQuerySchema;
export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuerySchema>;

export const publicAvailabilitySideSchema = z.object({
  id: z.string(),
  code: constructionSideSchema,
  description: z.string().nullable(),
  status: occupancyStatusSchema,
  busyIntervals: z.array(busyIntervalSchema),
});
export type PublicAvailabilitySide = z.infer<typeof publicAvailabilitySideSchema>;

export const publicAvailabilityConstructionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  sides: z.array(publicAvailabilitySideSchema),
});
export type PublicAvailabilityConstruction = z.infer<
  typeof publicAvailabilityConstructionSchema
>;

export const publicAvailabilityResponseSchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  items: z.array(publicAvailabilityConstructionSchema),
});
export type PublicAvailabilityResponse = z.infer<
  typeof publicAvailabilityResponseSchema
>;
