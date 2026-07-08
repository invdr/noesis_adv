import type {
  Asset as PrismaAsset,
  Developer as PrismaDeveloper,
  Project as PrismaProject,
  ProjectImage as PrismaProjectImage,
} from "@prisma/client";
import {
  normalizeProjectTools,
  roomsToLabel,
  type Badge,
  type Project,
  type RoomFormat,
} from "@gsk-tower/contracts";
import { toAssetDto } from "../files/file-dto";
import { toDeveloperDto } from "../developers/developer-dto";

/** Строка ЖК со всеми связями для DTO. */
export type ProjectRow = PrismaProject & {
  developer: (PrismaDeveloper & { logo: PrismaAsset | null }) | null;
  cover: PrismaAsset | null;
  images: (PrismaProjectImage & { asset: PrismaAsset })[];
};

/** Подключение связей ЖК — единый include для всех выборок. */
export const projectInclude = {
  developer: { include: { logo: true } },
  cover: true,
  images: { include: { asset: true }, orderBy: { position: "asc" as const } },
};

/** Что нужно DTO помимо строки БД. */
export interface ProjectDtoConfig {
  publicBase: string;
}

/** Маппинг строки БД в DTO: связи → Asset/Developer, комнатность → строка. */
export function toProjectDto(project: ProjectRow, cfg: ProjectDtoConfig): Project {
  const rooms = (project.rooms as RoomFormat[] | null) ?? [];
  const images = [...project.images]
    .sort((a, b) => a.position - b.position)
    .map((i) => toAssetDto(i.asset, cfg));

  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    address: project.address,
    developer: project.developer
      ? toDeveloperDto(project.developer, cfg)
      : undefined,
    priceFrom: project.priceFrom,
    rooms,
    roomsLabel: roomsToLabel(rooms),
    description: project.description,
    cover: project.cover ? toAssetDto(project.cover, cfg) : undefined,
    images,
    badges: (project.badges as Badge[] | null) ?? [],
    tools: normalizeProjectTools(project.tools),
    status: project.status,
    comingSoon: project.comingSoon,
    isArchived: project.archivedAt !== null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
