import type { Prisma } from "@prisma/client";
import type {
  InventoryAnalyticsQuery,
  InventoryAnalyticsResponse,
  InventorySideAnalytics,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import {
  dateOnlyToDate,
  daysBetween,
  mergeOverlaps,
  occupancyStatus,
  overlap,
} from "../bookings/booking-periods";

type AnalyticsBooking = {
  kind: string;
  status: string;
  startDate: Date;
  endDate: Date;
  totalPrice: number | null;
};

function plannedRevenue(bookings: AnalyticsBooking[], from: Date, to: Date): number {
  let total = 0;
  for (const booking of bookings) {
    if (
      booking.status === "cancelled" ||
      booking.kind !== "commercial" ||
      booking.totalPrice == null
    ) {
      continue;
    }
    const bookingDays = daysBetween(booking.startDate, booking.endDate);
    const clipped = overlap(booking, from, to);
    if (!clipped || bookingDays === 0) continue;
    total += Math.round((booking.totalPrice * clipped.days) / bookingDays);
  }
  return total;
}

function withoutPriceCount(bookings: AnalyticsBooking[]): number {
  return bookings.filter(
    (booking) =>
      booking.status !== "cancelled" &&
      booking.kind === "commercial" &&
      booking.totalPrice == null,
  ).length;
}

export async function getInventoryAnalytics(
  rt: Runtime,
  query: InventoryAnalyticsQuery,
): Promise<InventoryAnalyticsResponse> {
  const from = dateOnlyToDate(query.from);
  const to = dateOnlyToDate(query.to);
  const totalDays = daysBetween(from, to);
  const overlapWhere: Prisma.BookingWhereInput = {
    status: { not: "cancelled" },
    startDate: { lt: to },
    endDate: { gt: from },
  };

  const constructions = await rt.prisma.construction.findMany({
    where: {
      // Черновики ещё не составляют продаваемый инвентарь: их стороны не должны
      // занижать загрузку и увеличивать число свободных сторон.
      status: "published",
      OR: [
        { archivedAt: null },
        { sides: { some: { bookings: { some: overlapWhere } } } },
      ],
    },
    orderBy: [{ code: "asc" }, { name: "asc" }],
    include: {
      sides: {
        orderBy: { code: "asc" },
        include: {
          bookings: {
            where: overlapWhere,
            orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
            select: {
              kind: true,
              status: true,
              startDate: true,
              endDate: true,
              totalPrice: true,
            },
          },
        },
      },
    },
  });

  let totalSides = 0;
  let occupiedSideDays = 0;
  let plannedRevenueTotal = 0;
  let freeSides = 0;
  let bookingsCount = 0;
  let bookingsWithoutPrice = 0;

  const rows = constructions.flatMap((construction) => {
    // Архивная конструкция попадает в аналитику только из-за брони в окне
    // (см. OR выше). Её пустые стороны — не продаваемый инвентарь: считаем лишь
    // стороны с бронями, чтобы не завышать «свободные стороны»/знаменатель
    // загрузки. У активной конструкции показываем все стороны.
    const sourceSides =
      construction.archivedAt == null
        ? construction.sides
        : construction.sides.filter((side) => side.bookings.length > 0);
    if (sourceSides.length === 0) return [];

    const sides: InventorySideAnalytics[] = sourceSides.map((side) => {
      const bookings = side.bookings;
      const occupancy = mergeOverlaps(bookings, from, to);
      const status = occupancyStatus(occupancy.occupiedDays, totalDays);
      const revenue = plannedRevenue(bookings, from, to);
      const noPrice = withoutPriceCount(bookings);

      totalSides++;
      occupiedSideDays += occupancy.occupiedDays;
      plannedRevenueTotal += revenue;
      bookingsCount += bookings.length;
      bookingsWithoutPrice += noPrice;
      if (status === "free") freeSides++;

      return {
        sideId: side.id,
        sideCode: side.code as InventorySideAnalytics["sideCode"],
        sideDescription: side.description,
        trafficPerDay: side.trafficPerDay,
        grp: side.grp,
        effectivePricePerMonth: side.pricePerMonth ?? construction.pricePerMonth,
        status,
        totalDays,
        occupiedDays: occupancy.occupiedDays,
        occupancyRate: totalDays ? occupancy.occupiedDays / totalDays : 0,
        plannedRevenue: revenue,
        bookingsCount: bookings.length,
        bookingsWithoutPrice: noPrice,
        busyIntervals: occupancy.busyIntervals,
      };
    });

    return [
      {
        constructionId: construction.id,
        name: construction.name,
        code: construction.code,
        address: construction.address,
        sides,
      },
    ];
  });

  const totalSideDays = totalSides * totalDays;
  return {
    from: query.from,
    to: query.to,
    totalDays,
    totalSides,
    totalSideDays,
    occupiedSideDays,
    occupancyRate: totalSideDays ? occupiedSideDays / totalSideDays : 0,
    plannedRevenue: plannedRevenueTotal,
    freeSides,
    bookingsCount,
    bookingsWithoutPrice,
    constructions: rows,
  };
}
