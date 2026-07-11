import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  createBookingReport,
  deleteBookingReport,
  listBookingReports,
} from "../src/bookings/booking-report-service";

const user = {
  id: "u1",
  role: "manager" as const,
  email: "manager@example.com",
  name: null,
  mustChangePassword: false,
};
const activeBooking = {
  id: "b1",
  status: "onAir",
  startDate: new Date("2026-06-01T00:00:00.000Z"),
  endDate: new Date("2026-08-01T00:00:00.000Z"),
};

function runtimeWith(prisma: unknown): Runtime {
  return {
    env: { FILES_DIR: "/nonexistent-booking-report-files", FILES_PUBLIC_BASE: "/files" },
    prisma,
  } as Runtime;
}

function reportRow(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    bookingId: "b1",
    year: 2026,
    month: 6,
    reportDate: new Date("2026-06-15T00:00:00.000Z"),
    note: null,
    createdById: "u1",
    createdAt: new Date("2026-06-15T10:00:00.000Z"),
    updatedAt: new Date("2026-06-15T10:00:00.000Z"),
    photos: [],
    ...over,
  };
}

describe("booking reports", () => {
  test("создаёт один отчёт на месяц и нормализует пустой комментарий", async () => {
    let created: Record<string, unknown> | undefined;
    const prisma = {
      booking: { findUnique: async () => activeBooking },
      bookingReport: {
        count: async () => 0,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return reportRow(data);
        },
      },
    };

    const report = await createBookingReport(
      runtimeWith(prisma),
      user,
      "b1",
      { date: "2026-06-15", note: "  " },
    );

    expect(created).toMatchObject({ bookingId: "b1", year: 2026, month: 6, note: null });
    expect((created!.reportDate as Date).toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(report.date).toBe("2026-06-15");
  });

  test("не принимает дату за пределами периода брони", async () => {
    const prisma = { booking: { findUnique: async () => activeBooking } };
    await expect(
      createBookingReport(runtimeWith(prisma), user, "b1", { date: "2026-08-01" }),
    ).rejects.toMatchObject({ status: 422, code: "report_date_outside_booking" });
  });

  test("не позволяет менять отменённую бронь", async () => {
    const prisma = {
      booking: { findUnique: async () => ({ ...activeBooking, status: "cancelled" }) },
    };
    await expect(
      createBookingReport(runtimeWith(prisma), user, "b1", { date: "2026-06-15" }),
    ).rejects.toMatchObject({ status: 422, code: "cancelled_booking" });
  });

  test("гонка на уникальном месяце превращается в 409", async () => {
    const prisma = {
      booking: { findUnique: async () => activeBooking },
      bookingReport: {
        count: async () => 0,
        create: async () => {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        },
      },
    };
    await expect(
      createBookingReport(runtimeWith(prisma), user, "b1", { date: "2026-06-15" }),
    ).rejects.toMatchObject({ status: 409, code: "report_month_exists" });
  });

  test("DTO фотографии не раскрывает публичный /files URL", async () => {
    const prisma = {
      booking: { findUnique: async () => activeBooking },
      bookingReport: {
        findMany: async () => [
          reportRow({
            photos: [
              {
                id: "p1",
                reportId: "r1",
                assetId: "a1",
                position: 0,
                createdAt: new Date(),
                asset: {
                  id: "a1",
                  originalName: "placement.jpg",
                  storageKey: "booking-reports/ab/placement.jpg",
                },
              },
            ],
          }),
        ],
      },
    };
    const [report] = await listBookingReports(runtimeWith(prisma), "b1");
    expect(report!.photos[0]!.url).toBe("/api/bookings/b1/reports/r1/photos/p1/download");
    expect(report!.photos[0]!.url).not.toContain("/files/");
  });

  test("удаление отчёта очищает все прикреплённые файлы", async () => {
    const deletedAssets: string[] = [];
    let reportDeleted = false;
    const prisma = {
      bookingReport: {
        findFirst: async () => ({ id: "r1", year: 2026, month: 6 }),
        delete: async () => {
          reportDeleted = true;
        },
      },
      bookingReportPhoto: { findMany: async () => [{ assetId: "a1" }, { assetId: "a2" }] },
      asset: {
        findUnique: async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          storageKey: `booking-reports/ab/${where.id}.jpg`,
          renditions: [],
        }),
        delete: async ({ where }: { where: { id: string } }) => {
          deletedAssets.push(where.id);
        },
      },
    };
    await deleteBookingReport(runtimeWith(prisma), "b1", "r1");
    expect(reportDeleted).toBe(true);
    expect(deletedAssets).toEqual(["a1", "a2"]);
  });
});
