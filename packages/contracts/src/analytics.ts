import { z } from "zod";
import { stageColorSchema, stageKindSchema } from "./stage";
import { leadSourceSchema } from "./lead";

/**
 * Параметры дашборда аналитики. Период когортный — по дате ПОСТУПЛЕНИЯ заявки
 * (`createdAt`). Оба поля опциональны: если не заданы, сервис берёт последние
 * 30 дней. `from` включительно, `to` исключительно.
 */
export const analyticsQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    /** Фильтр источника для динамики по неделям (`weekly`); прочие срезы — по всей когорте. */
    source: leadSourceSchema.optional(),
  })
  // Оба поля — ISO-инстанты в UTC (`…Z`), поэтому лексикографическое сравнение
  // строк совпадает с хронологическим. Перевёрнутый период — ошибка ввода.
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "Начало периода не может быть позже конца",
    path: ["from"],
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/** Распределение по текущему этапу (живые этапы, в порядке воронки). */
export const stageBucketSchema = z.object({
  stageId: z.string(),
  name: z.string(),
  kind: stageKindSchema,
  color: stageColorSchema,
  count: z.number().int(),
});

/** Распределение по источнику формы. */
export const sourceBucketSchema = z.object({
  source: leadSourceSchema,
  /** Название источника из справочника (null — источник удалён). */
  name: z.string().nullable(),
  count: z.number().int(),
});

/** Распределение по конструкциям (только заявки с привязкой к конструкции). */
export const projectBucketSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  count: z.number().int(),
});

/**
 * Конверсия по когорте. Доли в диапазоне 0..1. `wonRate` — доля сделок от всех
 * заявок периода (основная цифра); `closeRate` — доля сделок среди закрытых
 * (won+lost), «качество отработки». Деление на ноль даёт 0.
 */
export const conversionSchema = z.object({
  won: z.number().int(),
  lost: z.number().int(),
  inProgress: z.number().int(),
  wonRate: z.number(),
  closeRate: z.number(),
});

/** Точка динамики по дням (день — по МСК, UTC+3). */
export const dailyPointSchema = z.object({
  date: z.string(),
  count: z.number().int(),
});

/**
 * Срез по менеджерам. `assigneeId: null` (и `email: null`) — строка
 * «не распределено»: заявки без ответственного или закрытые админом.
 */
export const managerBucketSchema = z.object({
  assigneeId: z.string().nullable(),
  email: z.string().nullable(),
  /** ФИО менеджера (если заполнено) — подпись приоритетнее email. */
  name: z.string().nullable(),
  leads: z.number().int(),
  won: z.number().int(),
  /** Отработанные контакты за период (done+cancelled и старые missed автора). */
  contacts: z.number().int(),
});

/**
 * Достижение этапа когортой по событиям истории (`LeadStatusEvent`): сколько
 * заявок периода когда-либо побывало на этапе. В порядке воронки — «водопад».
 */
export const funnelPointSchema = z.object({
  stageId: z.string(),
  name: z.string(),
  reached: z.number().int(),
});

/**
 * Время в этапе по парам соседних событий заявки: среднее и медиана в часах.
 * Только этапы, где были измеримые переходы (у терминальных «выхода» нет).
 */
export const stageDurationSchema = z.object({
  stageId: z.string(),
  name: z.string(),
  avgHours: z.number(),
  medianHours: z.number(),
});

/**
 * Точка динамики по неделям (неделя — понедельник МСК, `YYYY-MM-DD`).
 * `created` — по дате поступления; `won`/`lost` — по дате терминального события.
 */
export const weeklyPointSchema = z.object({
  weekStart: z.string(),
  created: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
});

export const analyticsResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  total: z.number().int(),
  byStage: z.array(stageBucketSchema),
  bySource: z.array(sourceBucketSchema),
  byProject: z.array(projectBucketSchema),
  conversion: conversionSchema,
  daily: z.array(dailyPointSchema),
  byManager: z.array(managerBucketSchema),
  /** Воронка-водопад: достижение этапов когортой (по событиям истории). */
  funnel: z.array(funnelPointSchema),
  /** Среднее/медиана времени в каждом этапе (часы). */
  stageDuration: z.array(stageDurationSchema),
  /** Динамика по неделям (создано/сделки/отказы); фильтруется параметром `source`. */
  weekly: z.array(weeklyPointSchema),
});
export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>;
export type FunnelPoint = z.infer<typeof funnelPointSchema>;
export type StageDurationPoint = z.infer<typeof stageDurationSchema>;
export type WeeklyPoint = z.infer<typeof weeklyPointSchema>;
