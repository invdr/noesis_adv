import type {
  Asset as PrismaAsset,
  Construction as PrismaConstruction,
  ConstructionImage as PrismaConstructionImage,
  Developer as PrismaDeveloper,
} from "@prisma/client";
import {
  pricePerMonthLabel,
  type Badge,
  type Construction,
  type ConstructionFormat,
  type ConstructionLighting,
} from "@noesis/contracts";
import { toAssetDto } from "../files/file-dto";
import { toDeveloperDto } from "../developers/developer-dto";

/** Строка конструкции со всеми связями для DTO. */
export type ConstructionRow = PrismaConstruction & {
  owner: (PrismaDeveloper & { logo: PrismaAsset | null }) | null;
  cover: PrismaAsset | null;
  images: (PrismaConstructionImage & { asset: PrismaAsset })[];
};

/** Подключение связей конструкции — единый include для всех выборок. */
export const constructionInclude = {
  owner: { include: { logo: true } },
  cover: true,
  images: { include: { asset: true }, orderBy: { position: "asc" as const } },
};

/** Что нужно DTO помимо строки БД. */
export interface ConstructionDtoConfig {
  publicBase: string;
}

/** Маппинг строки БД в DTO: связи → Asset/владелец, цена → готовая подпись. */
export function toConstructionDto(
  c: ConstructionRow,
  cfg: ConstructionDtoConfig,
): Construction {
  const images = [...c.images]
    .sort((a, b) => a.position - b.position)
    .map((i) => toAssetDto(i.asset, cfg));

  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    code: c.code,
    owner: c.owner ? toDeveloperDto(c.owner, cfg) : undefined,
    address: c.address,
    district: c.district,
    lat: c.lat,
    lng: c.lng,
    format: c.format as ConstructionFormat,
    size: c.size,
    sideCount: c.sideCount === 2 ? 2 : 1,
    lighting: c.lighting as ConstructionLighting,
    grp: c.grp,
    trafficPerDay: c.trafficPerDay,
    pricePerMonth: c.pricePerMonth,
    priceLabel: pricePerMonthLabel(c.pricePerMonth),
    description: c.description,
    cover: c.cover ? toAssetDto(c.cover, cfg) : undefined,
    images,
    badges: (c.badges as Badge[] | null) ?? [],
    status: c.status,
    isArchived: c.archivedAt !== null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
