import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import { getInventoryAnalytics } from "../src/inventory-analytics/inventory-analytics-service";

function d(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function runtimeWithRows(
  rows: any[],
  onFindMany?: (args: { where: unknown }) => void,
): Runtime {
  return {
    env: {},
    prisma: {
      construction: {
        findMany: async (args: { where: unknown }) => {
          onFindMany?.(args);
          return rows;
        },
      },
    },
  } as unknown as Runtime;
}

describe("getInventoryAnalytics", () => {
  test("учитывает только опубликованные конструкции", async () => {
    let where: unknown;
    await getInventoryAnalytics(
      runtimeWithRows([], (args) => {
        where = args.where;
      }),
      { from: "2026-07-01", to: "2026-08-01" },
    );

    expect(where).toMatchObject({ status: "published" });
  });

  test("считает загрузку по сторонам/дням и распределяет выручку по дням пересечения", async () => {
    const rt = runtimeWithRows([
      {
        id: "c1",
        name: "СФ-1",
        code: "СФ-1",
        address: "Грозный",
        pricePerMonth: 45_000,
        sides: [
          {
            id: "sideA",
            code: "A",
            description: "к центру",
            pricePerMonth: null,
            trafficPerDay: 10_000,
            grp: 2.4,
            bookings: [
              {
                kind: "commercial",
                status: "booked",
                startDate: d("2026-06-15"),
                endDate: d("2026-07-16"),
                totalPrice: 31_000,
              },
              {
                kind: "service",
                status: "onAir",
                startDate: d("2026-07-10"),
                endDate: d("2026-07-20"),
                totalPrice: null,
              },
              {
                kind: "commercial",
                status: "booked",
                startDate: d("2026-07-20"),
                endDate: d("2026-08-01"),
                totalPrice: null,
              },
            ],
          },
          {
            id: "sideB",
            code: "B",
            description: null,
            pricePerMonth: 40_000,
            trafficPerDay: null,
            grp: null,
            bookings: [],
          },
        ],
      },
    ]);

    const result = await getInventoryAnalytics(rt, {
      from: "2026-07-01",
      to: "2026-08-01",
    });

    expect(result.totalDays).toBe(31);
    expect(result.totalSides).toBe(2);
    expect(result.occupiedSideDays).toBe(31);
    expect(result.freeSides).toBe(1);
    expect(result.plannedRevenue).toBe(15_000);
    expect(result.bookingsWithoutPrice).toBe(1);

    const sideA = result.constructions[0]!.sides[0]!;
    expect(sideA.status).toBe("occupied");
    expect(sideA.occupancyRate).toBe(1);
    expect(sideA.busyIntervals).toEqual([
      { startDate: "2026-07-01", endDate: "2026-07-31" },
    ]);
    expect(sideA.bookingsCount).toBe(3);

    const sideB = result.constructions[0]!.sides[1]!;
    expect(sideB.status).toBe("free");
    expect(sideB.effectivePricePerMonth).toBe(40_000);
  });

  test("у архивной конструкции считает только стороны с бронями (пустые не завышают инвентарь)", async () => {
    const rt = runtimeWithRows([
      // Активная конструкция: обе стороны свободны — обе идут в инвентарь.
      {
        id: "c1",
        name: "СФ-1",
        code: "СФ-1",
        address: "Грозный",
        archivedAt: null,
        pricePerMonth: 45_000,
        sides: [
          { id: "c1A", code: "A", description: null, pricePerMonth: null, trafficPerDay: null, grp: null, bookings: [] },
          { id: "c1B", code: "B", description: null, pricePerMonth: null, trafficPerDay: null, grp: null, bookings: [] },
        ],
      },
      // Архивная конструкция попала в окно из-за брони на A; свободная сторона B
      // — не продаваемый инвентарь и не должна попадать в свободные/знаменатель.
      {
        id: "c2",
        name: "СФ-2",
        code: "СФ-2",
        address: "Грозный",
        archivedAt: d("2026-01-01"),
        pricePerMonth: 50_000,
        sides: [
          {
            id: "c2A",
            code: "A",
            description: null,
            pricePerMonth: null,
            trafficPerDay: null,
            grp: null,
            bookings: [
              {
                kind: "commercial",
                status: "booked",
                startDate: d("2026-07-01"),
                endDate: d("2026-08-01"),
                totalPrice: 50_000,
              },
            ],
          },
          { id: "c2B", code: "B", description: null, pricePerMonth: null, trafficPerDay: null, grp: null, bookings: [] },
        ],
      },
    ]);

    const result = await getInventoryAnalytics(rt, { from: "2026-07-01", to: "2026-08-01" });

    // 2 (активные A/B) + 1 (архивная A с бронью), архивная B отброшена.
    expect(result.totalSides).toBe(3);
    expect(result.freeSides).toBe(2);
    const archived = result.constructions.find((c) => c.constructionId === "c2")!;
    expect(archived.sides).toHaveLength(1);
    expect(archived.sides[0]!.sideCode).toBe("A");
  });
});
