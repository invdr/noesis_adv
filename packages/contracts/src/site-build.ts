import { z } from "zod";

/**
 * Состояние конвейера публикации лендинга (Веха 4.2).
 * - `idle` — сборщик свободен; сайт на последней успешной версии;
 * - `building` — сборка идёт прямо сейчас;
 * - `failed` — последняя сборка упала, сайт остался на прошлой рабочей версии.
 */
export const siteBuildStateSchema = z.enum(["idle", "building", "failed"]);
export type SiteBuildState = z.infer<typeof siteBuildStateSchema>;

/**
 * Статус сборки для CRM-индикатора. `unpublished` — в CRM есть сохранённые
 * правки, которых ещё нет на сайте; `pending` — публикацию уже запросили.
 */
export const siteBuildStatusSchema = z.object({
  status: siteBuildStateSchema,
  /** Есть сохранённые публичные изменения, ещё не опубликованные на сайте. */
  unpublished: z.boolean(),
  /** Когда появилась самая ранняя неопубликованная правка (ISO) или null. */
  unpublishedSince: z.string().nullable(),
  /** Публикация уже запрошена и ждёт/выполняет сборку. */
  pending: z.boolean(),
  /** Когда публикация была поставлена в очередь (ISO) или null. */
  pendingSince: z.string().nullable(),
  /** Время последней УСПЕШНОЙ публикации сайта (ISO) или null. */
  lastSuccessAt: z.string().nullable(),
  /** Время последней попытки сборки (успешной или нет) или null. */
  lastBuildAt: z.string().nullable(),
  /** Текст ошибки последней упавшей сборки (для плашки в CRM) или null. */
  lastError: z.string().nullable(),
});
export type SiteBuildStatus = z.infer<typeof siteBuildStatusSchema>;

/**
 * Ответ внутренней ручки claim сборщику: собирать ли сейчас. `buildId` —
 * метка взятой в работу пересборки, возвращается обратно в result.
 */
export const claimBuildResultSchema = z.object({
  build: z.boolean(),
  buildId: z.string().nullable(),
});
export type ClaimBuildResult = z.infer<typeof claimBuildResultSchema>;

/** Тело отчёта сборщика о результате (внутренняя ручка result). */
export const reportBuildSchema = z.object({
  buildId: z.string(),
  ok: z.boolean(),
  /** Хвост лога/текст ошибки при ok=false (обрезается сервисом). */
  error: z.string().optional(),
});
export type ReportBuildInput = z.infer<typeof reportBuildSchema>;
