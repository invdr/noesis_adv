import { Prisma } from "@prisma/client";
import {
  newsSchema,
  paginatedSchema,
  type ListNewsQuery,
  type News,
  type UpsertNewsInput,
} from "@gsk-tower/contracts";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { uniqueSlug } from "../http/slug";
import { fileBytes } from "../http/multipart";
import { deleteAsset, storeUpload } from "../files/file-service";
import { newsInclude, toNewsDto, type NewsRow } from "./news-dto";

const paginatedNews = paginatedSchema(newsSchema);
export type PaginatedNews = z.infer<typeof paginatedNews>;

/** Список новостей для CRM (фильтры + пагинация). По умолчанию — без архивных. */
export async function listNews(
  rt: Runtime,
  query: ListNewsQuery & { includeArchived?: boolean },
): Promise<PaginatedNews> {
  const where: Prisma.NewsWhereInput = {};
  if (!query.includeArchived) where.archivedAt = null;
  if (query.status) where.status = query.status;
  if (query.labelId) where.labelId = query.labelId;
  if (query.search) where.title = { contains: query.search, mode: "insensitive" };

  const [rows, total] = await rt.prisma.$transaction([
    rt.prisma.news.findMany({
      where,
      include: newsInclude,
      orderBy: { date: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    rt.prisma.news.count({ where }),
  ]);
  return {
    items: rows.map((n) => dto(rt, n)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** Карточка новости для CRM (включая архивную). */
export async function getNews(rt: Runtime, id: string): Promise<News> {
  const news = await rt.prisma.news.findUnique({ where: { id }, include: newsInclude });
  if (!news) throw new HttpError(404, "not_found", "Новость не найдена");
  return dto(rt, news);
}

/** Публичный список: только опубликованные и не архивные, от новых к старым. */
export async function listPublicNews(rt: Runtime): Promise<News[]> {
  const rows = await rt.prisma.news.findMany({
    where: { status: "published", archivedAt: null },
    include: newsInclude,
    orderBy: { date: "desc" },
  });
  return rows.map((n) => dto(rt, n));
}

/** Публичная статья по slug — только опубликованная не-архивная новость. */
export async function getPublicNewsBySlug(
  rt: Runtime,
  slug: string,
): Promise<News | null> {
  const news = await rt.prisma.news.findFirst({
    where: { slug, status: "published", archivedAt: null },
    include: newsInclude,
  });
  return news ? dto(rt, news) : null;
}

/** Создать новость. */
export function createNews(
  rt: Runtime,
  input: UpsertNewsInput,
  files: Map<string, File>,
  userId: string,
): Promise<News> {
  return saveNews(rt, input, files, userId, null);
}

/** Обновить новость (блокировка по версии). */
export function updateNews(
  rt: Runtime,
  id: string,
  input: UpsertNewsInput,
  files: Map<string, File>,
  userId: string,
): Promise<News> {
  return saveNews(rt, input, files, userId, id);
}

/** Архивировать новость (скрыть из CRM-списка и с сайта; запись и обложка целы). */
export async function archiveNews(rt: Runtime, id: string): Promise<News> {
  await requireNews(rt, id);
  const news = await rt.prisma.news.update({
    where: { id },
    data: { archivedAt: new Date() },
    include: newsInclude,
  });
  return dto(rt, news);
}

/** Восстановить новость из архива. */
export async function restoreNews(rt: Runtime, id: string): Promise<News> {
  await requireNews(rt, id);
  const news = await rt.prisma.news.update({
    where: { id },
    data: { archivedAt: null },
    include: newsInclude,
  });
  return dto(rt, news);
}

/** Удалить новость навсегда (admin): запись и файл обложки с диска. Необратимо. */
export async function deleteNews(rt: Runtime, id: string): Promise<void> {
  const news = await rt.prisma.news.findUnique({ where: { id } });
  if (!news) throw new HttpError(404, "not_found", "Новость не найдена");
  await rt.prisma.news.delete({ where: { id } });
  if (news.coverId) {
    await deleteAsset(rt, news.coverId).catch((e) =>
      console.error(`[news] не удалена обложка ${news.coverId}:`, e),
    );
  }
}

// --- внутреннее ---

function dto(rt: Runtime, news: NewsRow): News {
  return toNewsDto(news, { publicBase: rt.env.FILES_PUBLIC_BASE });
}

async function requireNews(rt: Runtime, id: string): Promise<void> {
  const exists = await rt.prisma.news.count({ where: { id } });
  if (!exists) throw new HttpError(404, "not_found", "Новость не найдена");
}

/**
 * Сохранить новость (создание/обновление одним кодом). Обложка — необязательный
 * файл `cover`. Порядок гарантирует «ноль сирот»: новая обложка грузится до
 * записи; при сбое — подчищается; старая обложка удаляется только после коммита.
 */
async function saveNews(
  rt: Runtime,
  input: UpsertNewsInput,
  files: Map<string, File>,
  userId: string,
  existingId: string | null,
): Promise<News> {
  if (input.labelId) {
    const exists = await rt.prisma.newsLabel.count({ where: { id: input.labelId } });
    if (!exists) throw new HttpError(422, "invalid_label", "Метка не найдена");
  }

  let current: NewsRow | null = null;
  if (existingId) {
    current = await rt.prisma.news.findUnique({
      where: { id: existingId },
      include: newsInclude,
    });
    if (!current) throw new HttpError(404, "not_found", "Новость не найдена");
    if (current.archivedAt) {
      throw new HttpError(409, "news_archived", "Новость в архиве — сначала восстановите");
    }
    if (
      input.expectedUpdatedAt &&
      current.updatedAt.toISOString() !== input.expectedUpdatedAt
    ) {
      throw new HttpError(
        409,
        "stale_update",
        "Новость обновил другой сотрудник, обновите страницу",
      );
    }
  }

  const slug = await resolveSlug(rt, input, current);

  const coverFile = files.get("cover");
  // Итоговое состояние обложки: новый файл > снять > оставить текущую.
  const willHaveCover = coverFile
    ? true
    : input.removeCover
      ? false
      : (current?.coverId ?? null) !== null;
  if (input.status === "published" && !willHaveCover) {
    throw new HttpError(422, "cover_required", "Для публикации нужна обложка", {
      cover: "Добавьте обложку",
    });
  }

  let newCoverId: string | null = null;
  let committed = false;
  try {
    if (coverFile) {
      const asset = await storeUpload(
        rt,
        { bytes: await fileBytes(coverFile), originalName: coverFile.name },
        { createdById: userId },
      );
      if (asset.kind !== "image") {
        await deleteAsset(rt, asset.id).catch(() => {});
        throw new HttpError(422, "expected_image", "Обложка должна быть изображением");
      }
      newCoverId = asset.id;
    }

    const coverId = coverFile
      ? newCoverId
      : input.removeCover
        ? null
        : (current?.coverId ?? null);

    const scalars = {
      title: input.title,
      labelId: input.labelId ?? null,
      date: input.date ? new Date(input.date) : (current?.date ?? new Date()),
      excerpt: input.excerpt ?? null,
      body: input.body ?? "",
      status: input.status,
    };

    const saved = current
      ? await rt.prisma.news.update({
          where: { id: current.id },
          data: { ...scalars, slug, coverId },
          include: newsInclude,
        })
      : await rt.prisma.news.create({
          data: { ...scalars, slug, coverId, createdById: userId },
          include: newsInclude,
        });
    committed = true;

    // Старая обложка больше не нужна — стираем после коммита.
    const oldCoverId = current?.coverId ?? null;
    if (oldCoverId && oldCoverId !== coverId) {
      await deleteAsset(rt, oldCoverId).catch((e) =>
        console.error(`[news] не удалена прежняя обложка ${oldCoverId}:`, e),
      );
    }
    return dto(rt, saved);
  } catch (err) {
    if (!committed && newCoverId) await deleteAsset(rt, newCoverId).catch(() => {});
    throw err;
  }
}

/** slug заморожен: при создании — из заголовка (или ручной), при правке — прежний. */
async function resolveSlug(
  rt: Runtime,
  input: UpsertNewsInput,
  current: NewsRow | null,
): Promise<string> {
  const taken = async (slug: string, exceptId?: string) =>
    (await rt.prisma.news.count({
      where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
    })) > 0;

  if (current) {
    if (input.slug && input.slug !== current.slug) {
      if (await taken(input.slug, current.id)) {
        throw new HttpError(422, "slug_taken", "Адрес уже занят", { slug: "Адрес уже занят" });
      }
      return input.slug;
    }
    return current.slug; // переименование адрес не меняет
  }
  if (input.slug) {
    if (await taken(input.slug)) {
      throw new HttpError(422, "slug_taken", "Адрес уже занят", { slug: "Адрес уже занят" });
    }
    return input.slug;
  }
  return uniqueSlug(input.title, (s) => taken(s), "news");
}
