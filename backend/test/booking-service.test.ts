import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import { createBooking } from "../src/bookings/booking-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const user = {
  id: "u1",
  email: "manager@test.local",
  name: "Менеджер",
  role: "manager" as const,
  mustChangePassword: false,
};

function makeDb() {
  const construction = {
    id: "c1",
    slug: "sf-1",
    name: "СФ-1",
    code: "СФ-1",
    address: "Грозный",
    district: null,
    lat: null,
    lng: null,
    ownerId: null,
    format: "cityFormat",
    size: null,
    sideCount: 2,
    lighting: "none",
    grp: null,
    trafficPerDay: null,
    pricePerMonth: 45_000,
    description: null,
    coverId: null,
    badges: [],
    status: "published",
    archivedAt: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const client = {
    id: "client1",
    kind: "client",
    fullName: "ООО Ромашка",
    phone: "+79990000000",
    companyName: null,
    archivedAt: null,
  };
  const bookings: any[] = [];

  function includeRow(row: any) {
    return {
      ...row,
      construction,
      client: row.clientId ? client : null,
      serviceReason: null,
      brand: null,
      lead: null,
      manager: row.managerId
        ? { id: row.managerId, email: "manager@test.local", name: "Менеджер" }
        : null,
      createdBy: row.createdById
        ? { id: row.createdById, email: "manager@test.local", name: "Менеджер" }
        : null,
    };
  }

  const db: any = {
    construction: { findUnique: async () => construction },
    contact: { findFirst: async () => client },
    bookingBrand: { findFirst: async () => null },
    bookingServiceReason: { findFirst: async () => null },
    lead: { count: async () => 0 },
    user: { count: async () => 1 },
    booking: {
      findUnique: async ({ where }: any) =>
        bookings.find((b) => b.id === where.id) ? includeRow(bookings.find((b) => b.id === where.id)) : null,
      findFirst: async ({ where }: any) => {
        const found = bookings.find((b) => {
          if (where.id?.not && b.id === where.id.not) return false;
          if (b.constructionId !== where.constructionId) return false;
          if ((b.side ?? null) !== (where.side ?? null)) return false;
          if (where.status?.not && b.status === where.status.not) return false;
          return b.startDate < where.startDate.lt && b.endDate > where.endDate.gt;
        });
        return found ? includeRow(found) : null;
      },
      create: async ({ data }: any) => {
        const row = {
          id: `b${bookings.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        bookings.push(row);
        return includeRow(row);
      },
      update: async ({ where, data }: any) => {
        const idx = bookings.findIndex((b) => b.id === where.id);
        bookings[idx] = { ...bookings[idx], ...data, updatedAt: new Date() };
        return includeRow(bookings[idx]);
      },
    },
    $transaction: async (fn: any) => fn(db),
  };
  return { db, bookings };
}

const input = {
  kind: "commercial" as const,
  status: "booked" as const,
  constructionId: "c1",
  side: "A" as const,
  clientId: "client1",
  startDate: "2026-05-05",
  durationMonths: 1,
};

describe("booking-service", () => {
  test("запрещает пересечение периода на той же стороне", async () => {
    const { db } = makeDb();
    const rt = runtimeWith(db);
    await createBooking(rt, user, input);

    await expect(
      createBooking(rt, user, { ...input, startDate: "2026-05-20" }),
    ).rejects.toMatchObject({ status: 409, code: "booking_overlap" });
  });

  test("разрешает стык-в-стык и другую сторону", async () => {
    const { db, bookings } = makeDb();
    const rt = runtimeWith(db);
    await createBooking(rt, user, input);

    await createBooking(rt, user, { ...input, startDate: "2026-06-05" });
    await createBooking(rt, user, { ...input, startDate: "2026-05-20", side: "B" });

    expect(bookings).toHaveLength(3);
  });

  test("отменённая бронь не занимает период", async () => {
    const { db, bookings } = makeDb();
    const rt = runtimeWith(db);
    await createBooking(rt, user, { ...input, status: "cancelled" });
    await createBooking(rt, user, { ...input, startDate: "2026-05-20" });
    expect(bookings).toHaveLength(2);
  });
});
