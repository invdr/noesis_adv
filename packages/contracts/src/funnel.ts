import { z } from "zod";

/** DTO воронки, который отдаёт API. */
export const funnelSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Позиция в списке воронок (меньше — раньше). */
  order: z.number().int(),
  /** Воронка по умолчанию: в её входной этап падают новые заявки. */
  isDefault: z.boolean(),
  /** Архивная воронка скрыта из выбора (этапы тоже в архиве). */
  isArchived: z.boolean(),
  /** Сколько живых этапов в воронке (для админ-экрана). */
  stageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Funnel = z.infer<typeof funnelSchema>;

/**
 * Создание воронки (admin). Сервис сразу заводит минимальный валидный набор
 * этапов (вход / успех / отказ), чтобы инварианты выполнялись с первого момента.
 */
export const createFunnelSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(80),
});
export type CreateFunnelInput = z.infer<typeof createFunnelSchema>;

/** Обновление воронки: переименование и/или назначение воронкой по умолчанию. */
export const updateFunnelSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название").max(80).optional(),
    /** Сделать воронкой по умолчанию (снять флаг с прочих). Снять напрямую нельзя. */
    isDefault: z.literal(true).optional(),
  })
  .refine((v) => v.name !== undefined || v.isDefault !== undefined, {
    message: "Нет изменений",
  });
export type UpdateFunnelInput = z.infer<typeof updateFunnelSchema>;

/** Новый порядок воронок — полный список id в нужной последовательности. */
export const reorderFunnelsSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderFunnelsInput = z.infer<typeof reorderFunnelsSchema>;
