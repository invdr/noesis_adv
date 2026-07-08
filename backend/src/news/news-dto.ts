import type {
  Asset as PrismaAsset,
  News as PrismaNews,
  NewsLabel as PrismaNewsLabel,
} from "@prisma/client";
import type { News, NewsLabel } from "@noesis/contracts";
import { toAssetDto } from "../files/file-dto";

/** Строка метки новости. */
export type NewsLabelRow = PrismaNewsLabel;

/** Строка новости со связями для DTO. */
export type NewsRow = PrismaNews & {
  label: PrismaNewsLabel | null;
  cover: PrismaAsset | null;
};

/** Подключение связей новости — единый include для всех выборок. */
export const newsInclude = {
  label: true,
  cover: true,
};

/** Что нужно DTO новости помимо строки БД. */
export interface NewsDtoConfig {
  publicBase: string;
}

/** Маппинг строки метки в DTO (archivedAt → флаг). */
export function toNewsLabelDto(label: NewsLabelRow): NewsLabel {
  return {
    id: label.id,
    name: label.name,
    slug: label.slug,
    order: label.order,
    isArchived: label.archivedAt !== null,
  };
}

/** Маппинг строки новости в DTO (обложка → Asset, метка → DTO, даты → ISO). */
export function toNewsDto(news: NewsRow, cfg: NewsDtoConfig): News {
  return {
    id: news.id,
    slug: news.slug,
    title: news.title,
    label: news.label ? toNewsLabelDto(news.label) : undefined,
    date: news.date.toISOString(),
    excerpt: news.excerpt,
    body: news.body,
    cover: news.cover ? toAssetDto(news.cover, cfg) : undefined,
    status: news.status,
    isArchived: news.archivedAt !== null,
    createdAt: news.createdAt.toISOString(),
    updatedAt: news.updatedAt.toISOString(),
  };
}
