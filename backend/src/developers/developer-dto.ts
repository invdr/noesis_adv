import type {
  Asset as PrismaAsset,
  Developer as PrismaDeveloper,
} from "@prisma/client";
import type { Developer } from "@noesis/contracts";
import { toAssetDto } from "../files/file-dto";

/** Строка владельца сети с подгруженным логотипом. */
export type DeveloperRow = PrismaDeveloper & { logo: PrismaAsset | null };

/** Что нужно DTO владельца сети помимо строки БД. */
export interface DeveloperDtoConfig {
  publicBase: string;
}

/** Маппинг строки БД в DTO контракта (логотип → Asset; archivedAt → флаг). */
export function toDeveloperDto(
  dev: DeveloperRow,
  cfg: DeveloperDtoConfig,
): Developer {
  return {
    id: dev.id,
    name: dev.name,
    legalName: dev.legalName,
    inn: dev.inn,
    kpp: dev.kpp,
    ogrn: dev.ogrn,
    legalAddress: dev.legalAddress,
    postalAddress: dev.postalAddress,
    bankName: dev.bankName,
    bankBik: dev.bankBik,
    bankAccount: dev.bankAccount,
    correspondentAccount: dev.correspondentAccount,
    directorTitle: dev.directorTitle,
    directorFullName: dev.directorFullName,
    directorBasis: dev.directorBasis,
    slug: dev.slug,
    logo: dev.logo ? toAssetDto(dev.logo, cfg) : undefined,
    isArchived: dev.archivedAt !== null,
    order: dev.order,
    createdAt: dev.createdAt.toISOString(),
  };
}
