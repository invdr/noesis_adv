import type {
  Asset as PrismaAsset,
  ProgressAlbum as PrismaProgressAlbum,
  ProgressPhoto as PrismaProgressPhoto,
} from "@prisma/client";
import type { ProgressAlbum } from "@gsk-tower/contracts";
import { toAssetDto } from "../files/file-dto";

/** Строка альбома хода строительства со связями для DTO. */
export type ProgressAlbumRow = PrismaProgressAlbum & {
  photos: (PrismaProgressPhoto & { asset: PrismaAsset })[];
};

/** Подключение связей альбома — единый include для всех выборок. */
export const progressAlbumInclude = {
  photos: {
    include: { asset: true },
    orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }],
  },
};

/** Что нужно DTO альбома помимо строки БД. */
export interface ProgressDtoConfig {
  publicBase: string;
}

/** Маппинг строки альбома в DTO (фото — в порядке позиции). */
export function toProgressAlbumDto(
  album: ProgressAlbumRow,
  cfg: ProgressDtoConfig,
): ProgressAlbum {
  return {
    id: album.id,
    year: album.year,
    month: album.month,
    note: album.note,
    photos: album.photos.map((p) => toAssetDto(p.asset, cfg)),
    createdAt: album.createdAt.toISOString(),
  };
}
