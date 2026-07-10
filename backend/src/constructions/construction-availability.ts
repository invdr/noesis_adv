import type {
  PublicAvailabilityQuery,
  PublicAvailabilityResponse,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import {
  dateOnlyToDate,
  daysBetween,
  mergeOverlaps,
  occupancyStatus,
} from "../bookings/booking-periods";

export async function getPublicAvailability(
  rt: Runtime,
  query: PublicAvailabilityQuery,
): Promise<PublicAvailabilityResponse> {
  const from = dateOnlyToDate(query.from);
  const to = dateOnlyToDate(query.to);
  const totalDays = daysBetween(from, to);
  const rows = await rt.prisma.construction.findMany({
    where: { status: "published", archivedAt: null },
    orderBy: [{ code: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      code: true,
      address: true,
      lat: true,
      lng: true,
      sides: {
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          description: true,
          bookings: {
            where: {
              status: { not: "cancelled" },
              startDate: { lt: to },
              endDate: { gt: from },
            },
            select: { startDate: true, endDate: true },
            orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
          },
        },
      },
    },
  });

  return {
    from: query.from,
    to: query.to,
    items: rows.map((construction) => ({
      id: construction.id,
      slug: construction.slug,
      name: construction.name,
      code: construction.code,
      address: construction.address,
      lat: construction.lat,
      lng: construction.lng,
      sides: construction.sides.map((side) => {
        const occupancy = mergeOverlaps(side.bookings, from, to);
        return {
          id: side.id,
          code: side.code as "A" | "B" | "C",
          description: side.description,
          status: occupancyStatus(occupancy.occupiedDays, totalDays),
          busyIntervals: occupancy.busyIntervals,
        };
      }),
    })),
  };
}
