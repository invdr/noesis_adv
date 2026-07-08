import { z } from "zod";

/**
 * Тип (исход) этапа воронки. Определяет поведение, а не только метку:
 * - `in_progress` — заявка активна (в работе менеджера);
 * - `won` / `lost` — сделка закрыта (уходит из активной работы, дата
 *   следующего контакта не требуется). Используется в аналитике конверсии.
 */
export const stageKindSchema = z.enum(["in_progress", "won", "lost"]);
export type StageKind = z.infer<typeof stageKindSchema>;

/**
 * Базовая палитра цвета этапа. Цвет выбирает admin; он красит колонку на доске
 * и блоки этапа в CRM (раньше цвет выводился из `kind` — теперь это отдельная,
 * независимая от поведения настройка).
 */
export const stageColorSchema = z.enum([
  "slate",
  "blue",
  "green",
  "amber",
  "red",
  "violet",
  "teal",
  "pink",
]);
export type StageColor = z.infer<typeof stageColorSchema>;

/** Цвета для пикера в CRM (значение + подпись). */
export const STAGE_COLORS: { value: StageColor; label: string }[] = [
  { value: "slate", label: "Серый" },
  { value: "blue", label: "Бордовый" },
  { value: "green", label: "Зелёный" },
  { value: "amber", label: "Янтарный" },
  { value: "red", label: "Красный" },
  { value: "violet", label: "Фиолетовый" },
  { value: "teal", label: "Бирюзовый" },
  { value: "pink", label: "Розовый" },
];

/** Акцентный hex по токену цвета — для инлайновых мест (бары аналитики). */
export const STAGE_COLOR_HEX: Record<StageColor, string> = {
  slate: "#64748b",
  blue: "#A4161A",
  green: "#059669",
  amber: "#d97706",
  red: "#dc2626",
  violet: "#7c3aed",
  teal: "#0d9488",
  pink: "#db2777",
};

/** DTO этапа воронки, который отдаёт API. */
export const stageSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Воронка, которой принадлежит этап. */
  funnelId: z.string(),
  /** Позиция в воронке (плоский список, меньше — левее/раньше). */
  order: z.number().int(),
  kind: stageKindSchema,
  /** Цвет блока этапа (колонка доски, чипы в CRM). */
  color: stageColorSchema,
  /** Этап входа: сюда падают новые заявки. Ровно один среди живых этапов. */
  isEntry: z.boolean(),
  /** Архивный этап скрыт из воронки, но сохранён для истории/аналитики. */
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Stage = z.infer<typeof stageSchema>;

/** Создание этапа (admin). Позиция и флаги задаются сервисом/по умолчанию. */
export const createStageSchema = z.object({
  /** В какую воронку добавляем этап. */
  funnelId: z.string().min(1, "Укажите воронку"),
  name: z.string().trim().min(1, "Укажите название").max(80),
  kind: stageKindSchema,
  /** Необязателен: сервис подставит цвет по умолчанию. */
  color: stageColorSchema.optional(),
});
export type CreateStageInput = z.infer<typeof createStageSchema>;

/**
 * Обновление этапа (admin). Любое поле опционально; инварианты воронки
 * (≥1 `won`, ≥1 `lost`, ровно 1 `isEntry`) проверяет сервис. Снять `isEntry`
 * напрямую нельзя — флаг переносится назначением его другому этапу.
 */
export const updateStageSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название").max(80).optional(),
    kind: stageKindSchema.optional(),
    color: stageColorSchema.optional(),
    isEntry: z.literal(true).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.kind !== undefined ||
      v.color !== undefined ||
      v.isEntry !== undefined,
    { message: "Нет изменений" },
  );
export type UpdateStageInput = z.infer<typeof updateStageSchema>;

/** Новый порядок этапов — полный список id в нужной последовательности. */
export const reorderStagesSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderStagesInput = z.infer<typeof reorderStagesSchema>;

/**
 * Архивация этапа (admin) с переносом его заявок в `targetStageId`.
 * Если целевой этап терминальный (`won`/`lost`), требуется явное
 * подтверждение `confirmTerminal` — заявки будут помечены закрытыми.
 */
export const archiveStageSchema = z.object({
  targetStageId: z.string(),
  confirmTerminal: z.boolean().optional(),
});
export type ArchiveStageInput = z.infer<typeof archiveStageSchema>;
