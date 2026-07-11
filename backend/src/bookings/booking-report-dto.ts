import type {
  Asset as PrismaAsset,
  BookingReport as PrismaBookingReport,
  BookingReportPhoto as PrismaBookingReportPhoto,
} from "@prisma/client";
import type { BookingReport } from "@noesis/contracts";
import { toDateOnly } from "./booking-dto";

export type BookingReportRow = PrismaBookingReport & {
  photos: (PrismaBookingReportPhoto & { asset: PrismaAsset })[];
};

export const bookingReportInclude = {
  photos: {
    include: { asset: true },
    orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }],
  },
};

/** Photos deliberately expose only an auth-gated API URL, never `/files/...`. */
export function toBookingReportDto(row: BookingReportRow): BookingReport {
  return {
    id: row.id,
    date: toDateOnly(row.reportDate),
    note: row.note,
    photos: row.photos.map((photo) => ({
      id: photo.id,
      originalName: photo.asset.originalName,
      url: `/api/bookings/${row.bookingId}/reports/${row.id}/photos/${photo.id}/download`,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}
