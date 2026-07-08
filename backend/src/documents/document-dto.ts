import type {
  Asset as PrismaAsset,
  Document as PrismaDocument,
  DocumentCategory as PrismaDocumentCategory,
} from "@prisma/client";
import type { Document, DocumentCategory } from "@gsk-tower/contracts";
import { toAssetDto } from "../files/file-dto";

/** Строка категории документов. */
export type DocumentCategoryRow = PrismaDocumentCategory;

/** Строка документа со связями для DTO. */
export type DocumentRow = PrismaDocument & {
  category: PrismaDocumentCategory | null;
  asset: PrismaAsset | null;
};

/** Подключение связей документа — единый include для всех выборок. */
export const documentInclude = {
  category: true,
  asset: true,
};

/** Что нужно DTO документа помимо строки БД. */
export interface DocumentDtoConfig {
  publicBase: string;
}

/** Маппинг строки категории в DTO (archivedAt → флаг). */
export function toDocumentCategoryDto(cat: DocumentCategoryRow): DocumentCategory {
  return {
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    order: cat.order,
    isArchived: cat.archivedAt !== null,
  };
}

/**
 * Маппинг строки документа в DTO. Размечен по `kind`: `link` несёт url + ручную
 * подпись, `file` — загруженный `Asset` (тип и размер берутся из него).
 */
export function toDocumentDto(doc: DocumentRow, cfg: DocumentDtoConfig): Document {
  const category = doc.category ? toDocumentCategoryDto(doc.category) : undefined;
  if (doc.kind === "link") {
    return {
      kind: "link",
      id: doc.id,
      name: doc.name,
      category,
      url: doc.url ?? "",
      caption: doc.caption,
      createdAt: doc.createdAt.toISOString(),
    };
  }
  return {
    kind: "file",
    id: doc.id,
    name: doc.name,
    category,
    asset: toAssetDto(doc.asset!, cfg),
    createdAt: doc.createdAt.toISOString(),
  };
}
