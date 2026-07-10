import type {
  Asset as PrismaAsset,
  Booking as PrismaBooking,
  Construction as PrismaConstruction,
  ConstructionSide as PrismaConstructionSide,
  DealDocument as PrismaDealDocument,
} from "@prisma/client";
import type {
  BookingKind,
  BookingStatus,
  ConstructionSide,
  DealBookingSummary,
  DealDocument,
  DealDocumentType,
} from "@noesis/contracts";
import { toAssetDto } from "../files/file-dto";
import { previousDateOnly, toDateOnly } from "../bookings/booking-periods";

export type DealDocumentRow = PrismaDealDocument & { asset: PrismaAsset };

export const dealDocumentInclude = { asset: true } as const;

export function toDealDocumentDto(
  row: DealDocumentRow,
  cfg: { publicBase: string },
): DealDocument {
  return {
    id: row.id,
    type: row.type as DealDocumentType,
    name: row.name,
    asset: toAssetDto(row.asset, cfg),
    createdAt: row.createdAt.toISOString(),
  };
}

export type DealBookingRow = PrismaBooking & {
  construction: Pick<PrismaConstruction, "name" | "code">;
  constructionSide: Pick<PrismaConstructionSide, "code">;
};

export const dealBookingInclude = {
  construction: { select: { name: true, code: true } },
  constructionSide: { select: { code: true } },
} as const;

export function toDealBookingSummary(row: DealBookingRow): DealBookingSummary {
  return {
    id: row.id,
    kind: row.kind as BookingKind,
    status: row.status as BookingStatus,
    constructionName: row.construction.name,
    constructionCode: row.construction.code,
    sideCode: row.constructionSide.code as ConstructionSide,
    startDate: toDateOnly(row.startDate),
    endDate: previousDateOnly(row.endDate),
    totalPrice: row.totalPrice,
  };
}
