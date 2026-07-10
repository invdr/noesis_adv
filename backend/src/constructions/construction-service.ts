import { Prisma } from "@prisma/client";
import {
  CONSTRUCTION_SIDE_CODES,
  constructionSchema,
  paginatedSchema,
  type Construction,
  type ConstructionSide,
  type ConstructionSideInput,
  type ListConstructionsQuery,
  type UpsertConstructionInput,
} from "@noesis/contracts";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { uniqueSlug } from "../http/slug";
import { fileBytes } from "../http/multipart";
import { deleteAsset, storeUpload } from "../files/file-service";
import {
  constructionInclude,
  toConstructionDto,
  type ConstructionRow,
} from "./construction-dto";

const paginatedConstructions = paginatedSchema(constructionSchema);
export type PaginatedConstructions = z.infer<typeof paginatedConstructions>;

/** Список конструкций для CRM (фильтры + пагинация). По умолчанию — без архивных. */
export async function listConstructions(
  rt: Runtime,
  query: ListConstructionsQuery & { includeArchived?: boolean },
): Promise<PaginatedConstructions> {
  const where: Prisma.ConstructionWhereInput = {};
  if (!query.includeArchived) where.archivedAt = null;
  if (query.status) where.status = query.status;
  if (query.format) where.format = query.format;
  if (query.search) where.name = { contains: query.search, mode: "insensitive" };

  const [rows, total] = await rt.prisma.$transaction([
    rt.prisma.construction.findMany({
      where,
      include: constructionInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    rt.prisma.construction.count({ where }),
  ]);
  return {
    items: rows.map((c) => dto(rt, c)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** Карточка конструкции для CRM (включая архивную). */
export async function getConstruction(
  rt: Runtime,
  id: string,
): Promise<Construction> {
  const construction = await rt.prisma.construction.findUnique({
    where: { id },
    include: constructionInclude,
  });
  if (!construction) throw new HttpError(404, "not_found", "Конструкция не найдена");
  return dto(rt, construction);
}

/** Публичный список: только опубликованные и не архивные. */
export async function listPublicConstructions(
  rt: Runtime,
): Promise<Construction[]> {
  const rows = await rt.prisma.construction.findMany({
    where: { status: "published", archivedAt: null },
    include: constructionInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows.map((c) => dto(rt, c));
}

/** Публичная страница по slug — только опубликованная не-архивная конструкция. */
export async function getPublicConstructionBySlug(
  rt: Runtime,
  slug: string,
): Promise<Construction | null> {
  const construction = await rt.prisma.construction.findFirst({
    where: { slug, status: "published", archivedAt: null },
    include: constructionInclude,
  });
  return construction ? dto(rt, construction) : null;
}

/** Создать конструкцию. */
export function createConstruction(
  rt: Runtime,
  input: UpsertConstructionInput,
  files: Map<string, File>,
  userId: string,
): Promise<Construction> {
  return saveConstruction(rt, input, files, userId, null);
}

/** Обновить конструкцию (полный снимок состояния + блокировка по версии). */
export function updateConstruction(
  rt: Runtime,
  id: string,
  input: UpsertConstructionInput,
  files: Map<string, File>,
  userId: string,
): Promise<Construction> {
  return saveConstruction(rt, input, files, userId, id);
}

/** Архивировать конструкцию (скрыть из CRM и с сайта; запись и фото сохранены). */
export async function archiveConstruction(
  rt: Runtime,
  id: string,
): Promise<Construction> {
  await requireConstruction(rt, id);
  const activeBookings = await rt.prisma.booking.count({
    where: {
      constructionId: id,
      status: { not: "cancelled" },
      endDate: { gt: new Date() },
    },
  });
  if (activeBookings > 0) {
    throw new HttpError(
      409,
      "construction_has_active_bookings",
      "У конструкции есть текущие или будущие брони — сначала отмените или перенесите их",
    );
  }
  const construction = await rt.prisma.construction.update({
    where: { id },
    data: { archivedAt: new Date() },
    include: constructionInclude,
  });
  return dto(rt, construction);
}

/** Восстановить конструкцию из архива. */
export async function restoreConstruction(
  rt: Runtime,
  id: string,
): Promise<Construction> {
  await requireConstruction(rt, id);
  const construction = await rt.prisma.construction.update({
    where: { id },
    data: { archivedAt: null },
    include: constructionInclude,
  });
  return dto(rt, construction);
}

/**
 * Удалить конструкцию навсегда (admin): запись (каскадом — фото-связи) и все
 * файлы (обложка + галерея) с диска. Необратимо.
 */
export async function deleteConstruction(rt: Runtime, id: string): Promise<void> {
  const construction = await rt.prisma.construction.findUnique({
    where: { id },
    include: { images: true, documents: true },
  });
  if (!construction) throw new HttpError(404, "not_found", "Конструкция не найдена");

  const bookings = await rt.prisma.booking.count({ where: { constructionId: id } });
  if (bookings > 0) {
    throw new HttpError(
      409,
      "construction_has_bookings",
      `Конструкцию используют брони (${bookings}). Используйте архив.`,
    );
  }

  const assetIds = new Set<string>(construction.images.map((i) => i.assetId));
  if (construction.coverId) assetIds.add(construction.coverId);
  // Документы-файлы уходят каскадом (по constructionId), но их файлы на диске —
  // через файловый сервис; ссылки-документы файлов не имеют.
  for (const doc of construction.documents) {
    if (doc.assetId) assetIds.add(doc.assetId);
  }

  await rt.prisma.construction.delete({ where: { id } });
  for (const assetId of assetIds) {
    await deleteAsset(rt, assetId).catch((e) =>
      console.error(`[constructions] не удалён файл ${assetId}:`, e),
    );
  }
}

// --- внутреннее ---

function dto(rt: Runtime, construction: ConstructionRow): Construction {
  return toConstructionDto(construction, { publicBase: rt.env.FILES_PUBLIC_BASE });
}

async function requireConstruction(rt: Runtime, id: string): Promise<void> {
  const exists = await rt.prisma.construction.count({ where: { id } });
  if (!exists) throw new HttpError(404, "not_found", "Конструкция не найдена");
}

/**
 * Сохранить конструкцию (создание/обновление одним кодом). Порядок гарантирует
 * «ноль сирот»: новые файлы грузим до записи; при сбое транзакции — подчищаем
 * их; убранные из галереи фото удаляем только после успешного коммита.
 */
async function saveConstruction(
  rt: Runtime,
  input: UpsertConstructionInput,
  files: Map<string, File>,
  userId: string,
  existingId: string | null,
): Promise<Construction> {
  if (input.ownerId) {
    const owner = await rt.prisma.developer.count({ where: { id: input.ownerId } });
    if (!owner) throw new HttpError(422, "invalid_owner", "Владелец сети не найден");
  }

  let current: ConstructionRow | null = null;
  if (existingId) {
    current = await rt.prisma.construction.findUnique({
      where: { id: existingId },
      include: constructionInclude,
    });
    if (!current) throw new HttpError(404, "not_found", "Конструкция не найдена");
    if (current.archivedAt) {
      throw new HttpError(
        409,
        "construction_archived",
        "Конструкция в архиве — сначала восстановите",
      );
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
      throw new HttpError(422, "unknown_image", "Фото не принадлежит этой конструкции");
    }
    if (item.kind === "new" && !files.has(`image_${item.uploadIndex}`)) {
      throw new HttpError(422, "missing_file", `Не передан файл image_${item.uploadIndex}`);
    }
  }

  const newAssetIds: string[] = [];
  let removedAssetIds: string[] = [];
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
    const imageCreate = finalAssets.map((f) => ({
      position: f.position,
      asset: { connect: { id: f.assetId } },
    }));
    const scalars = {
      name: input.name,
      code: input.code ?? null,
      address: input.address ?? null,
      district: input.district ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      ownerId: input.ownerId ?? null,
      format: input.format,
      size: input.size ?? null,
      sideCount: input.sideCount,
      lighting: input.lighting,
      grp: input.grp ?? null,
      trafficPerDay: input.trafficPerDay ?? null,
      pricePerMonth: input.pricePerMonth ?? null,
      description: input.description ?? null,
      badges: (input.badges ?? []) as unknown as Prisma.InputJsonValue,
      status: input.status,
    };

    const saved = current
      ? await rt.prisma.$transaction(async (tx) => {
          const fresh = await tx.construction.findUnique({
            where: { id: current!.id },
            include: constructionInclude,
          });
          if (!fresh) throw new HttpError(404, "not_found", "Конструкция не найдена");
          if (fresh.archivedAt) {
            throw new HttpError(
              409,
              "construction_archived",
              "Конструкция в архиве — сначала восстановите",
            );
          }
          if (
            input.expectedUpdatedAt &&
            fresh.updatedAt.toISOString() !== input.expectedUpdatedAt
          ) {
            throw new HttpError(
              409,
              "stale_update",
              "Карточку обновил другой сотрудник, обновите страницу",
            );
          }

          const freshAssetIds = new Set(fresh.images.map((i) => i.assetId));
          for (const item of items) {
            if (item.kind === "existing" && !freshAssetIds.has(item.assetId)) {
              throw new HttpError(422, "unknown_image", "Фото не принадлежит этой конструкции");
            }
          }
          removedAssetIds = fresh.images
            .map((i) => i.assetId)
            .filter((aid) => !finalAssets.some((f) => f.assetId === aid));

          await tx.constructionImage.deleteMany({
            where: { constructionId: fresh.id },
          });
          const updated = await tx.construction.update({
            where: { id: fresh.id },
            data: { ...scalars, slug, coverId, images: { create: imageCreate } },
          });
          await syncConstructionSides(tx, {
            constructionId: updated.id,
            constructionGrp: input.grp ?? null,
            constructionTrafficPerDay: input.trafficPerDay ?? null,
            sideCount: input.sideCount,
            sideInputs: input.sides ?? [],
            finalAssets,
            current: fresh,
          });
          return tx.construction.findUniqueOrThrow({
            where: { id: updated.id },
            include: constructionInclude,
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      : await rt.prisma.$transaction(async (tx) => {
          const created = await tx.construction.create({
            data: {
              ...scalars,
              slug,
              coverId,
              createdById: userId,
              images: { create: imageCreate },
            },
          });
          await syncConstructionSides(tx, {
            constructionId: created.id,
            constructionGrp: input.grp ?? null,
            constructionTrafficPerDay: input.trafficPerDay ?? null,
            sideCount: input.sideCount,
            sideInputs: input.sides ?? [],
            finalAssets,
            current: null,
          });
          return tx.construction.findUniqueOrThrow({
            where: { id: created.id },
            include: constructionInclude,
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    committed = true;

    // После коммита убранные фото удаляем навсегда.
    for (const aid of removedAssetIds) {
      await deleteAsset(rt, aid).catch((e) =>
        console.error(`[constructions] не удалён убранный файл ${aid}:`, e),
      );
    }
    return dto(rt, saved);
  } catch (err) {
    // Транзакция не прошла — подчищаем только что загруженные файлы-сироты.
    if (!committed) {
      for (const aid of newAssetIds) await deleteAsset(rt, aid).catch(() => {});
    }
    if (isSerializationFailure(err)) {
      throw new HttpError(
        409,
        "construction_update_conflict",
        "Конструкцию изменили параллельно, обновите карточку и повторите",
      );
    }
    throw err;
  }
}

interface FinalAsset {
  assetId: string;
  position: number;
}

async function syncConstructionSides(
  tx: Prisma.TransactionClient,
  args: {
    constructionId: string;
    constructionGrp: number | null;
    constructionTrafficPerDay: number | null;
    sideCount: 1 | 2 | 3;
    sideInputs: ConstructionSideInput[];
    finalAssets: FinalAsset[];
    current: ConstructionRow | null;
  },
): Promise<void> {
  const activeCodes = CONSTRUCTION_SIDE_CODES.slice(0, args.sideCount);
  const activeCodeSet = new Set<ConstructionSide>(activeCodes);
  const inputByCode = new Map(args.sideInputs.map((side) => [side.code, side]));
  const currentByCode = new Map(
    (args.current?.sides ?? []).map((side) => [side.code as ConstructionSide, side]),
  );
  const removedSides = (args.current?.sides ?? []).filter(
    (side) => !activeCodeSet.has(side.code as ConstructionSide),
  );
  if (removedSides.length > 0) {
    const bookings = await tx.booking.count({
      where: { constructionSideId: { in: removedSides.map((side) => side.id) } },
    });
    if (bookings > 0) {
      throw sideHasBookingsError();
    }
    try {
      await tx.constructionSide.deleteMany({
        where: { id: { in: removedSides.map((side) => side.id) } },
      });
    } catch (err) {
      if (isSideDeletionRace(err)) throw sideHasBookingsError();
      throw err;
    }
  }

  for (const code of activeCodes) {
    const input = inputByCode.get(code);
    const currentSide = currentByCode.get(code);
    const photoId =
      input?.photoIndex != null
        ? (args.finalAssets[input.photoIndex]?.assetId ?? null)
        : (input ? null : (currentSide?.photoId ?? null));
    const data = {
      description:
        input !== undefined ? (input.description ?? null) : (currentSide?.description ?? null),
      pricePerMonth:
        input !== undefined ? (input.pricePerMonth ?? null) : (currentSide?.pricePerMonth ?? null),
      trafficPerDay:
        input !== undefined
          ? (input.trafficPerDay ?? null)
          : currentSide !== undefined
            ? currentSide.trafficPerDay
            : args.constructionTrafficPerDay,
      grp:
        input !== undefined
          ? (input.grp ?? null)
          : currentSide !== undefined
            ? currentSide.grp
            : args.constructionGrp,
      photoId,
    };

    await tx.constructionSide.upsert({
      where: { constructionId_code: { constructionId: args.constructionId, code } },
      update: data,
      create: {
        constructionId: args.constructionId,
        code,
        ...data,
      },
    });
  }
}

function sideHasBookingsError(): HttpError {
  return new HttpError(
    409,
    "construction_side_has_bookings",
    "Нельзя уменьшить число сторон: на удаляемой стороне есть брони",
    { sideCount: "На удаляемой стороне есть брони" },
  );
}

function isSideDeletionRace(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
}

function isSerializationFailure(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}

/** slug заморожен: при создании — из имени (или ручной), при правке — прежний. */
async function resolveSlug(
  rt: Runtime,
  input: UpsertConstructionInput,
  current: ConstructionRow | null,
): Promise<string> {
  const taken = async (slug: string, exceptId?: string) =>
    (await rt.prisma.construction.count({
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
  return uniqueSlug(input.name, (s) => taken(s), "construction");
}
