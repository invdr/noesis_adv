import { z } from "zod";

/**
 * Веб-источники лендинга: их id-слаги зашиты в формы сайта
 * (`website/public/js/main.js`, `page.js`), поэтому строки справочника с этими
 * id заблокированы полностью (нельзя переименовать/архивировать/удалить).
 */
export const WEB_SOURCE_IDS = ["hero_form", "project", "contacts"] as const;

/**
 * DTO источника заявки (управляемый справочник). Правила редактирования:
 * `isWeb` — заблокирован полностью; `isSystem` без `isWeb` («Оффлайн»/«Прочее») —
 * можно переименовать, нельзя удалить/архивировать (дефолты ручного приёма);
 * кастомные — полный CRUD, удаление блокируется использованием (архив).
 */
export const leadSourceOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Позиция в списках выбора (меньше — раньше). */
  order: z.number().int(),
  isSystem: z.boolean(),
  isWeb: z.boolean(),
  /** Архивный источник скрыт из выбора; ссылки заявок сохранены. */
  isArchived: z.boolean(),
});
export type LeadSourceOption = z.infer<typeof leadSourceOptionSchema>;

/** Создание/переименование источника (admin). Порядок назначает сервис. */
export const upsertLeadSourceSchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(60),
});
export type UpsertLeadSourceInput = z.infer<typeof upsertLeadSourceSchema>;

/** Новый порядок источников — полный список id живых строк. */
export const reorderLeadSourcesSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderLeadSourcesInput = z.infer<typeof reorderLeadSourcesSchema>;
