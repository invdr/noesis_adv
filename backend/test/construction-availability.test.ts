import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import { getPublicAvailability } from "../src/constructions/construction-availability";

function d(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function runtimeWithRows(rows: any[]): Runtime {
  return {
    env: {},
    prisma: {
      construction: {
        findMany: async () => rows,
      },
    },
  } as unknown as Runtime;
}

describe("getPublicAvailability", () => {
  test("возвращает только публичную занятость без клиента, бренда и цены", async () => {
    const rt = runtimeWithRows([
      {
        id: "c1",
        slug: "sf-1",
        name: "СФ-1",
        code: "СФ-1",
        address: "Грозный",
        lat: 43.3,
        lng: 45.7,
        sides: [
          {
            id: "sideA",
            code: "A",
            description: "к центру",
            bookings: [
              { startDate: d("2026-07-01"), endDate: d("2026-07-06") },
              { startDate: d("2026-07-20"), endDate: d("2026-07-26") },
            ],
          },
          {
            id: "sideB",
            code: "B",
            description: null,
            bookings: [{ startDate: d("2026-07-01"), endDate: d("2026-08-01") }],
          },
          {
            id: "sideC",
            code: "C",
            description: null,
            bookings: [],
          },
        ],
      },
    ]);

    const result = await getPublicAvailability(rt, {
      from: "2026-07-01",
      to: "2026-08-01",
    });

    const [sideA, sideB, sideC] = result.items[0]!.sides;
    expect(sideA!.status).toBe("partiallyOccupied");
    expect(sideA!.busyIntervals).toEqual([
      { startDate: "2026-07-01", endDate: "2026-07-05" },
      { startDate: "2026-07-20", endDate: "2026-07-25" },
    ]);
    expect(sideB!.status).toBe("occupied");
    expect(sideC!.status).toBe("free");

    const payload = JSON.stringify(result);
    expect(payload).not.toContain("client");
    expect(payload).not.toContain("brand");
    expect(payload).not.toContain("price");
    expect(payload).not.toContain("totalPrice");
  });
});
