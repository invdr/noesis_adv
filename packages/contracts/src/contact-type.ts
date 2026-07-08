import { z } from "zod";

/** DTO типа следующего контакта (справочник). */
export const contactTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Позиция в списке (меньше — раньше). */
  order: z.number().int(),
  /** Архивный тип скрыт из выбора; ссылки заявок сохранены. */
  isArchived: z.boolean(),
});
export type ContactType = z.infer<typeof contactTypeSchema>;

/** Создание/переименование типа контакта (admin). Порядок назначает сервис. */
export const upsertContactTypeSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(40),
});
export type UpsertContactTypeInput = z.infer<typeof upsertContactTypeSchema>;

/** Новый порядок типов — полный список id в нужной последовательности. */
export const reorderContactTypesSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderContactTypesInput = z.infer<typeof reorderContactTypesSchema>;
