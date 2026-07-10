import { z } from "zod";
import { assetSchema } from "./file";
import {
  bookingKindSchema,
  bookingStatusSchema,
  dateOnlySchema,
} from "./booking";
import { constructionSideSchema } from "./construction";

/**
 * Этап 4 «Сделки и документы». «Сделка» — это выигранная заявка (отдельной
 * сущности нет): её брони + прикреплённые закрывающие документы. Документы пока
 * только прикрепляются (генерация — отдельный заход); сделку можно явно пометить
 * «без документов».
 */

/** Тип закрывающего документа сделки. */
export const dealDocumentTypeSchema = z.enum([
  "contract",
  "invoice",
  "act",
  "other",
]);
export type DealDocumentType = z.infer<typeof dealDocumentTypeSchema>;

export const DEAL_DOCUMENT_TYPE_LABEL: Record<DealDocumentType, string> = {
  contract: "Договор",
  invoice: "Счёт",
  act: "Акт",
  other: "Иное",
};

/** DTO прикреплённого документа сделки. */
export const dealDocumentSchema = z.object({
  id: z.string(),
  type: dealDocumentTypeSchema,
  name: z.string(),
  asset: assetSchema,
  createdAt: z.string(),
});
export type DealDocument = z.infer<typeof dealDocumentSchema>;

/**
 * Прикрепление документа к сделке (multipart: `data` JSON + файл `file`).
 * Название необязательно — сервис возьмёт имя файла без расширения.
 */
export const createDealDocumentSchema = z.object({
  type: dealDocumentTypeSchema.default("other"),
  name: z.string().trim().max(200).optional(),
});
export type CreateDealDocumentInput = z.infer<typeof createDealDocumentSchema>;

/** Переключение отметки «по сделке документов нет». */
export const updateDealSchema = z.object({
  noDocuments: z.boolean(),
});
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

/** Краткая строка брони сделки (read-only во вкладке «Сделка»). */
export const dealBookingSummarySchema = z.object({
  id: z.string(),
  kind: bookingKindSchema,
  status: bookingStatusSchema,
  constructionName: z.string(),
  constructionCode: z.string().nullable(),
  sideCode: constructionSideSchema,
  startDate: dateOnlySchema,
  /** Последний день размещения (включительно, для вывода). */
  endDate: dateOnlySchema,
  totalPrice: z.number().int().nullable(),
});
export type DealBookingSummary = z.infer<typeof dealBookingSummarySchema>;
