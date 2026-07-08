import { z } from "zod";
import { contactKindSchema } from "./contact";

/**
 * Аналитика работы с партнёрами (риелторы/агентства). Отдельный модуль от
 * дашборда заявок (`analytics.ts`): грейн здесь — партнёр, а не когорта заявок.
 * Период когортный по дате поступления приведённой заявки (`createdAt`), как в
 * основном дашборде. Видимость (менеджер — по своим заявкам) — в сервисе.
 */

/** Параметры: период, тип партнёра, поиск по ФИО. */
export const partnerAnalyticsQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    /** Только риелторы или только агентства; иначе — оба типа. */
    kind: z.enum(["realtor", "agency"]).optional(),
    search: z.string().trim().max(120).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "Начало периода не может быть позже конца",
    path: ["from"],
  });
export type PartnerAnalyticsQuery = z.infer<typeof partnerAnalyticsQuerySchema>;

/** Строка аналитики по одному партнёру. `conversion` — доля 0..1 (deals/referred). */
export const partnerRowSchema = z.object({
  contactId: z.string(),
  fullName: z.string(),
  kind: contactKindSchema,
  /** Агентство риелтора (для kind=realtor); иначе null. */
  agencyId: z.string().nullable(),
  agencyName: z.string().nullable(),
  /** Эффективная дата последнего взаимодействия (ручная либо по заявкам); ISO. */
  lastInteractionAt: z.string().nullable(),
  /** Приведённые лиды за период. */
  referredLeads: z.number().int(),
  /** Из них совершённые сделки (текущий этап kind=won). */
  deals: z.number().int(),
  conversion: z.number(),
});
export type PartnerRow = z.infer<typeof partnerRowSchema>;

export const partnerAnalyticsResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(partnerRowSchema),
});
export type PartnerAnalyticsResponse = z.infer<typeof partnerAnalyticsResponseSchema>;
