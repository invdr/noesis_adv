import { Prisma } from "@prisma/client";
import {
  EMPTY_PROJECT_TOOLS,
  paginatedSchema,
  projectSchema,
  type ListProjectsQuery,
  type Project,
  type UpsertProjectInput,
} from "@noesis/contracts";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { uniqueSlug } from "../http/slug";
import { fileBytes } from "../http/multipart";
import { deleteAsset, storeUpload } from "../files/file-service";
import { projectInclude, toProjectDto, type ProjectRow } from "./project-dto";

const paginatedProjects = paginatedSchema(projectSchema);
export type PaginatedProjects = z.infer<typeof paginatedProjects>;

/** Список ЖК для CRM (фильтры + пагинация). По умолчанию — без архивных. */
export async function listProjects(
  rt: Runtime,
  query: ListProjectsQuery & { includeArchived?: boolean },
): Promise<PaginatedProjects> {
  const where: Prisma.ProjectWhereInput = {};
  if (!query.includeArchived) where.archivedAt = null;
  if (query.status) where.status = query.status;
  if (query.search) where.name = { contains: query.search, mode: "insensitive" };

  const [rows, total] = await rt.prisma.$transaction([
    rt.prisma.project.findMany({
      where,
      include: projectInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    rt.prisma.project.count({ where }),
  ]);
  return {
    items: rows.map((p) => dto(rt, p)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** Карточка ЖК для CRM (включая архивную). */
export async function getProject(rt: Runtime, id: string): Promise<Project> {
  const project = await rt.prisma.project.findUnique({
    where: { id },
    include: projectInclude,
  });
  if (!project) throw new HttpError(404, "not_found", "ЖК не найден");
  return dto(rt, project);
}

/** Публичный список: только опубликованные и не архивные (включая «скоро»). */
export async function listPublicProjects(rt: Runtime): Promise<Project[]> {
  const rows = await rt.prisma.project.findMany({
    where: { status: "published", archivedAt: null },
    include: projectInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows.map((p) => dto(rt, p));
}

/**
 * Публичная страница по slug — только обычный опубликованный ЖК. «Скоро»
 * (тизер без страницы) и архив сюда не попадают → вызывающий отдаёт 404.
 */
export async function getPublicProjectBySlug(
  rt: Runtime,
  slug: string,
): Promise<Project | null> {
  const project = await rt.prisma.project.findFirst({
    where: { slug, status: "published", comingSoon: false, archivedAt: null },
    include: projectInclude,
  });
  return project ? dto(rt, project) : null;
}

/** Создать ЖК. */
export function createProject(
  rt: Runtime,
  input: UpsertProjectInput,
  files: Map<string, File>,
  userId: string,
): Promise<Project> {
  return saveProject(rt, input, files, userId, null);
}

/** Обновить ЖК (полный снимок состояния + блокировка по версии). */
export function updateProject(
  rt: Runtime,
  id: string,
  input: UpsertProjectInput,
  files: Map<string, File>,
  userId: string,
): Promise<Project> {
  return saveProject(rt, input, files, userId, id);
}

/** Архивировать ЖК (скрыть из CRM и с сайта; запись и фото сохранены). */
export async function archiveProject(rt: Runtime, id: string): Promise<Project> {
  await requireProject(rt, id);
  const project = await rt.prisma.project.update({
    where: { id },
    data: { archivedAt: new Date() },
    include: projectInclude,
  });
  return dto(rt, project);
}

/** Восстановить ЖК из архива. */
export async function restoreProject(rt: Runtime, id: string): Promise<Project> {
  await requireProject(rt, id);
  const project = await rt.prisma.project.update({
    where: { id },
    data: { archivedAt: null },
    include: projectInclude,
  });
  return dto(rt, project);
}

/**
 * Удалить ЖК навсегда (admin): запись (каскадом — фото-связи) и все файлы
 * (обложка + галерея) с диска. Необратимо.
 */
export async function deleteProject(rt: Runtime, id: string): Promise<void> {
  const project = await rt.prisma.project.findUnique({
    where: { id },
    include: { images: true, documents: true },
  });
  if (!project) throw new HttpError(404, "not_found", "ЖК не найден");

  const assetIds = new Set<string>(project.images.map((i) => i.assetId));
  if (project.coverId) assetIds.add(project.coverId);
  // Документы-файлы уходят каскадом (по projectId), но их файлы на диске —
  // через файловый сервис; ссылки-документы файлов не имеют.
  for (const doc of project.documents) {
    if (doc.assetId) assetIds.add(doc.assetId);
  }

  await rt.prisma.project.delete({ where: { id } });
  for (const assetId of assetIds) {
    await deleteAsset(rt, assetId).catch((e) =>
      console.error(`[projects] не удалён файл ${assetId}:`, e),
    );
  }
}

// --- внутреннее ---

function dto(rt: Runtime, project: ProjectRow): Project {
  return toProjectDto(project, { publicBase: rt.env.FILES_PUBLIC_BASE });
}

async function requireProject(rt: Runtime, id: string): Promise<void> {
  const exists = await rt.prisma.project.count({ where: { id } });
  if (!exists) throw new HttpError(404, "not_found", "ЖК не найден");
}

/**
 * Сохранить ЖК (создание/обновление одним кодом). Порядок гарантирует «ноль
 * сирот»: новые файлы грузим до записи; при сбое транзакции — подчищаем их;
 * убранные из галереи фото удаляем только после успешного коммита.
 */
async function saveProject(
  rt: Runtime,
  input: UpsertProjectInput,
  files: Map<string, File>,
  userId: string,
  existingId: string | null,
): Promise<Project> {
  if (input.developerId) {
    const dev = await rt.prisma.developer.count({ where: { id: input.developerId } });
    if (!dev) throw new HttpError(422, "invalid_developer", "Застройщик не найден");
  }

  let current: ProjectRow | null = null;
  if (existingId) {
    current = await rt.prisma.project.findUnique({
      where: { id: existingId },
      include: projectInclude,
    });
    if (!current) throw new HttpError(404, "not_found", "ЖК не найден");
    if (current.archivedAt) {
      throw new HttpError(409, "project_archived", "ЖК в архиве — сначала восстановите");
    }
    if (
      input.expectedUpdatedAt &&
      current.updatedAt.toISOString() !== input.expectedUpdatedAt
    ) {
      throw new HttpError(
        409,
        "stale_update",
        "Карточку обновил другой сотрудник, обновите страницу",
      );
    }
  }

  const slug = await resolveSlug(rt, input, current);

  // Проверяем состав галереи до загрузки: existing — только из своих фото,
  // new — файл должен быть в форме.
  const items = input.images ?? [];
  const currentAssetIds = new Set((current?.images ?? []).map((i) => i.assetId));
  for (const item of items) {
    if (item.kind === "existing" && !currentAssetIds.has(item.assetId)) {
      throw new HttpError(422, "unknown_image", "Фото не принадлежит этому ЖК");
    }
    if (item.kind === "new" && !files.has(`image_${item.uploadIndex}`)) {
      throw new HttpError(422, "missing_file", `Не передан файл image_${item.uploadIndex}`);
    }
  }

  const newAssetIds: string[] = [];
  let committed = false;
  try {
    // Грузим новые файлы (каждый коммитит свой Asset).
    const uploadedByIndex = new Map<number, string>();
    for (const item of items) {
      if (item.kind !== "new") continue;
      const file = files.get(`image_${item.uploadIndex}`)!;
      const asset = await storeUpload(
        rt,
        { bytes: await fileBytes(file), originalName: file.name },
        { createdById: userId },
      );
      if (asset.kind !== "image") {
        await deleteAsset(rt, asset.id).catch(() => {});
        throw new HttpError(422, "expected_image", "В галерею можно загружать только изображения");
      }
      newAssetIds.push(asset.id);
      uploadedByIndex.set(item.uploadIndex, asset.id);
    }

    const finalAssets = items.map((item, position) => ({
      assetId:
        item.kind === "existing" ? item.assetId : uploadedByIndex.get(item.uploadIndex)!,
      position,
    }));
    const coverId =
      input.coverIndex !== undefined && input.coverIndex < finalAssets.length
        ? finalAssets[input.coverIndex]!.assetId
        : null;
    const removedAssetIds = (current?.images ?? [])
      .map((i) => i.assetId)
      .filter((aid) => !finalAssets.some((f) => f.assetId === aid));

    const imageCreate = finalAssets.map((f) => ({
      position: f.position,
      asset: { connect: { id: f.assetId } },
    }));
    const scalars = {
      name: input.name,
      address: input.address ?? null,
      developerId: input.developerId ?? null,
      priceFrom: input.priceFrom ?? null,
      rooms: (input.rooms ?? []) as unknown as Prisma.InputJsonValue,
      description: input.description ?? null,
      badges: (input.badges ?? []) as unknown as Prisma.InputJsonValue,
      tools: (input.tools ?? EMPTY_PROJECT_TOOLS) as unknown as Prisma.InputJsonValue,
      status: input.status,
      comingSoon: input.comingSoon ?? false,
    };

    const saved = current
      ? await rt.prisma.$transaction(async (tx) => {
          await tx.projectImage.deleteMany({ where: { projectId: current!.id } });
          return tx.project.update({
            where: { id: current!.id },
            data: { ...scalars, slug, coverId, images: { create: imageCreate } },
            include: projectInclude,
          });
        })
      : await rt.prisma.project.create({
          data: {
            ...scalars,
            slug,
            coverId,
            createdById: userId,
            images: { create: imageCreate },
          },
          include: projectInclude,
        });
    committed = true;

    // После коммита убранные фото удаляем навсегда (решение №4).
    for (const aid of removedAssetIds) {
      await deleteAsset(rt, aid).catch((e) =>
        console.error(`[projects] не удалён убранный файл ${aid}:`, e),
      );
    }
    return dto(rt, saved);
  } catch (err) {
    // Транзакция не прошла — подчищаем только что загруженные файлы-сироты.
    if (!committed) {
      for (const aid of newAssetIds) await deleteAsset(rt, aid).catch(() => {});
    }
    throw err;
  }
}

/** slug заморожен: при создании — из имени (или ручной), при правке — прежний. */
async function resolveSlug(
  rt: Runtime,
  input: UpsertProjectInput,
  current: ProjectRow | null,
): Promise<string> {
  const taken = async (slug: string, exceptId?: string) =>
    (await rt.prisma.project.count({
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
  return uniqueSlug(input.name, (s) => taken(s), "zhk");
}
