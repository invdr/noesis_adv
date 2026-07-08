import {
  type ProgressAlbum,
  type UpsertProgressAlbumInput,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { fileBytes } from "../http/multipart";
import { deleteAsset, storeUpload } from "../files/file-service";
import {
  progressAlbumInclude,
  toProgressAlbumDto,
  type ProgressAlbumRow,
} from "./progress-dto";

/** Порядок альбомов: от новых месяцев к старым. */
const albumOrderBy = [{ year: "desc" as const }, { month: "desc" as const }];

/** Альбомы хода строительства одного ЖК для CRM (включая пустые). */
export async function listProjectProgress(
  rt: Runtime,
  projectId: string,
): Promise<ProgressAlbum[]> {
  await requireProject(rt, projectId);
  const rows = await rt.prisma.progressAlbum.findMany({
    where: { projectId },
    include: progressAlbumInclude,
    orderBy: albumOrderBy,
  });
  return rows.map((a) => dto(rt, a));
}

/** Создать альбом периода. Один альбом на месяц — повтор периода отклоняется. */
export async function createProgressAlbum(
  rt: Runtime,
  projectId: string,
  input: UpsertProgressAlbumInput,
  userId: string,
): Promise<ProgressAlbum> {
  await requireProject(rt, projectId);
  await requireFreePeriod(rt, projectId, input.year, input.month);
  try {
    const album = await rt.prisma.progressAlbum.create({
      data: {
        projectId,
        year: input.year,
        month: input.month,
        note: input.note?.trim() || null,
        createdById: userId,
      },
      include: progressAlbumInclude,
    });
    return dto(rt, album);
  } catch (err) {
    throw mapPeriodConflict(err);
  }
}

/** Правка периода/комментария альбома. */
export async function updateProgressAlbum(
  rt: Runtime,
  projectId: string,
  id: string,
  input: UpsertProgressAlbumInput,
): Promise<ProgressAlbum> {
  const album = await requireAlbum(rt, projectId, id);
  if (album.year !== input.year || album.month !== input.month) {
    await requireFreePeriod(rt, projectId, input.year, input.month);
  }
  try {
    const updated = await rt.prisma.progressAlbum.update({
      where: { id },
      data: {
        year: input.year,
        month: input.month,
        note: input.note?.trim() || null,
      },
      include: progressAlbumInclude,
    });
    return dto(rt, updated);
  } catch (err) {
    throw mapPeriodConflict(err);
  }
}

/** Удалить альбом со всеми фото — сразу и навсегда (файлы чистит файловый сервис). */
export async function deleteProgressAlbum(
  rt: Runtime,
  projectId: string,
  id: string,
): Promise<void> {
  await requireAlbum(rt, projectId, id);
  const photos = await rt.prisma.progressPhoto.findMany({
    where: { albumId: id },
    select: { assetId: true },
  });
  await rt.prisma.progressAlbum.delete({ where: { id } });
  for (const p of photos) {
    await deleteAsset(rt, p.assetId).catch((e) =>
      console.error(`[progress] не удалён файл ${p.assetId}:`, e),
    );
  }
}

/**
 * Добавить фото в альбом (мгновенная операция, файлы `photo_0`, `photo_1`, …).
 * Каждое фото валидируется как изображение; при сбое записи — подчищаем
 * загруженное (ноль сирот). Успешно добавленные до сбоя остаются.
 */
export async function addProgressPhotos(
  rt: Runtime,
  projectId: string,
  albumId: string,
  files: File[],
  userId: string,
): Promise<ProgressAlbum> {
  await requireAlbum(rt, projectId, albumId);
  if (files.length === 0) {
    throw new HttpError(422, "missing_file", "Не переданы фотографии");
  }
  let position = await nextPosition(rt, albumId);
  for (const file of files) {
    const asset = await storeUpload(
      rt,
      { bytes: await fileBytes(file), originalName: file.name },
      { createdById: userId },
    );
    if (asset.kind !== "image") {
      await deleteAsset(rt, asset.id).catch(() => {});
      throw new HttpError(
        422,
        "expected_image",
        "В ход строительства можно загружать только изображения",
      );
    }
    try {
      await rt.prisma.progressPhoto.create({
        data: { albumId, assetId: asset.id, position: position++ },
      });
    } catch (err) {
      await deleteAsset(rt, asset.id).catch(() => {});
      throw err;
    }
  }
  const album = await rt.prisma.progressAlbum.findUnique({
    where: { id: albumId },
    include: progressAlbumInclude,
  });
  // Альбом могли удалить конкурентно, пока грузились фото.
  if (!album) throw new HttpError(404, "not_found", "Альбом не найден");
  return dto(rt, album);
}

/** Удалить фото из альбома — сразу и навсегда. */
export async function deleteProgressPhoto(
  rt: Runtime,
  projectId: string,
  albumId: string,
  photoId: string,
): Promise<void> {
  await requireAlbum(rt, projectId, albumId);
  const photo = await rt.prisma.progressPhoto.findFirst({
    where: { id: photoId, albumId },
  });
  if (!photo) throw new HttpError(404, "not_found", "Фото не найдено");
  await rt.prisma.progressPhoto.delete({ where: { id: photoId } });
  await deleteAsset(rt, photo.assetId).catch((e) =>
    console.error(`[progress] не удалён файл ${photo.assetId}:`, e),
  );
}

/**
 * Ход строительства опубликованного ЖК по slug для лендинга: непустые альбомы
 * от новых месяцев к старым. «Скоро» и архив страницы не имеют → null
 * (вызывающий отдаёт 404).
 */
export async function listPublicProjectProgress(
  rt: Runtime,
  slug: string,
): Promise<ProgressAlbum[] | null> {
  const project = await rt.prisma.project.findFirst({
    where: { slug, status: "published", comingSoon: false, archivedAt: null },
    select: { id: true },
  });
  if (!project) return null;
  const rows = await rt.prisma.progressAlbum.findMany({
    where: { projectId: project.id, photos: { some: {} } },
    include: progressAlbumInclude,
    orderBy: albumOrderBy,
  });
  return rows.map((a) => dto(rt, a));
}

// --- внутреннее ---

function dto(rt: Runtime, album: ProgressAlbumRow): ProgressAlbum {
  return toProgressAlbumDto(album, { publicBase: rt.env.FILES_PUBLIC_BASE });
}

async function requireProject(rt: Runtime, id: string): Promise<void> {
  const exists = await rt.prisma.project.count({ where: { id } });
  if (!exists) throw new HttpError(404, "not_found", "ЖК не найден");
}

async function requireAlbum(
  rt: Runtime,
  projectId: string,
  id: string,
): Promise<{ year: number; month: number }> {
  const album = await rt.prisma.progressAlbum.findFirst({
    where: { id, projectId },
    select: { year: true, month: true },
  });
  if (!album) throw new HttpError(404, "not_found", "Альбом не найден");
  return album;
}

/**
 * Гонка двух запросов на один период: check-then-act в `requireFreePeriod`
 * пропускает оба, второй падает на unique-констрейнте `projectId+year+month`
 * (Prisma P2002) — отдаём тот же 409, что и проверка, а не 500.
 */
function mapPeriodConflict(err: unknown): unknown {
  if (err && typeof err === "object" && (err as { code?: unknown }).code === "P2002") {
    return new HttpError(
      409,
      "period_exists",
      "Альбом за этот месяц уже есть — добавьте фото в него",
    );
  }
  return err;
}

/** Один альбом на период: повтор года+месяца в рамках ЖК отклоняется. */
async function requireFreePeriod(
  rt: Runtime,
  projectId: string,
  year: number,
  month: number,
): Promise<void> {
  const exists = await rt.prisma.progressAlbum.count({
    where: { projectId, year, month },
  });
  if (exists) {
    throw new HttpError(
      409,
      "period_exists",
      "Альбом за этот месяц уже есть — добавьте фото в него",
    );
  }
}

/** Следующая позиция фото в альбоме. */
async function nextPosition(rt: Runtime, albumId: string): Promise<number> {
  const last = await rt.prisma.progressPhoto.findFirst({
    where: { albumId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}
