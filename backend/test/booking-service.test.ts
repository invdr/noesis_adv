import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import { createBooking, listBookings, updateBooking } from "../src/bookings/booking-service";

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

function makeSide(code: "A" | "B" | "C", overrides: Record<string, unknown> = {}) {
  return {
    id: `side${code}`,
    constructionId: "c1",
    code,
    description: null,
    pricePerMonth: null,
    trafficPerDay: null,
    grp: null,
    photoId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDb(options: { sideCount?: 1 | 2 | 3; pricePerMonth?: number | null } = {}) {
  const sideCount = options.sideCount ?? 2;
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
    sideCount,
    lighting: "none",
    grp: null,
    trafficPerDay: null,
    pricePerMonth: options.pricePerMonth ?? 45_000,
    description: null,
    coverId: null,
    badges: [],
    status: "published",
    archivedAt: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const sides = [
    makeSide("A"),
    makeSide("B", { pricePerMonth: 40_000 }),
    makeSide("C", { pricePerMonth: 55_000 }),
  ].slice(0, sideCount);
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
      constructionSide: sides.find((side) => side.id === row.constructionSideId) ?? sides[0],
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
    construction: { findUnique: async () => ({ ...construction, sides }) },
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
          if (b.constructionSideId !== where.constructionSideId) return false;
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
  return { db, bookings, construction, sides };
}

const input = {
  kind: "commercial" as const,
  status: "booked" as const,
  constructionId: "c1",
  constructionSideId: "sideA",
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
    ).rejects.toMatchObject({
      status: 409,
      code: "booking_overlap",
      message: expect.stringContaining("2026-05-05–2026-06-04"),
    });
  });

  test("разрешает стык-в-стык и другую сторону", async () => {
    const { db, bookings } = makeDb();
    const rt = runtimeWith(db);
    await createBooking(rt, user, input);

    await createBooking(rt, user, { ...input, startDate: "2026-06-05" });
    await createBooking(rt, user, { ...input, startDate: "2026-05-20", constructionSideId: "sideB" });

    expect(bookings).toHaveLength(3);
  });

  test("отменённая бронь не занимает период", async () => {
    const { db, bookings } = makeDb();
    const rt = runtimeWith(db);
    await createBooking(rt, user, { ...input, status: "cancelled" });
    await createBooking(rt, user, { ...input, startDate: "2026-05-20" });
    expect(bookings).toHaveLength(2);
  });

  test("односторонняя конструкция технически бронирует сторону A без выбора", async () => {
    const { db, bookings } = makeDb({ sideCount: 1 });
    const rt = runtimeWith(db);

    await createBooking(rt, user, { ...input, constructionSideId: undefined });

    expect(bookings[0]!.constructionSideId).toBe("sideA");
  });

  test("односторонняя конструкция отклоняет явный legacy-код не-A", async () => {
    const { db } = makeDb({ sideCount: 1 });
    const rt = runtimeWith(db);

    await expect(
      createBooking(rt, user, {
        ...input,
        constructionSideId: undefined,
        side: "B",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_side" });
  });

  test("невалидный explicit constructionSideId не падает на legacy side", async () => {
    const { db } = makeDb();
    const rt = runtimeWith(db);

    await expect(
      createBooking(rt, user, {
        ...input,
        constructionSideId: "missing-side",
        side: "B",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_side" });
  });

  test("конфликт explicit constructionSideId и legacy side отклоняется", async () => {
    const { db } = makeDb();
    const rt = runtimeWith(db);

    await expect(
      createBooking(rt, user, {
        ...input,
        constructionSideId: "sideA",
        side: "B",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_side" });
  });

  test("трёхсторонняя конструкция считает пересечения отдельно для C", async () => {
    const { db, bookings } = makeDb({ sideCount: 3 });
    const rt = runtimeWith(db);

    await createBooking(rt, user, { ...input, constructionSideId: "sideC" });
    await expect(
      createBooking(rt, user, { ...input, constructionSideId: "sideC", startDate: "2026-05-20" }),
    ).rejects.toMatchObject({ status: 409, code: "booking_overlap" });
    await createBooking(rt, user, { ...input, constructionSideId: "sideB", startDate: "2026-05-20" });

    expect(bookings).toHaveLength(2);
  });

  test("дефолт цены берётся со стороны, затем с конструкции", async () => {
    const { db, bookings } = makeDb();
    const rt = runtimeWith(db);

    await createBooking(rt, user, { ...input, constructionSideId: "sideB", startDate: "2026-07-01" });
    await createBooking(rt, user, { ...input, constructionSideId: "sideA", startDate: "2026-07-01" });

    expect(bookings[0]!.basePricePerMonth).toBe(40_000);
    expect(bookings[0]!.totalPrice).toBe(40_000);
    expect(bookings[1]!.basePricePerMonth).toBe(45_000);
    expect(bookings[1]!.totalPrice).toBe(45_000);
  });

  test("обновление без полей цены сохраняет снимок стоимости", async () => {
    const { db, bookings, sides, construction } = makeDb();
    const rt = runtimeWith(db);

    await createBooking(rt, user, { ...input, constructionSideId: "sideB" });
    (sides[1] as any).pricePerMonth = 60_000;
    (construction as any).pricePerMonth = 70_000;
    await updateBooking(rt, user, "b1", {
      ...input,
      constructionSideId: "sideB",
      startDate: "2026-06-05",
      durationMonths: 2,
    });

    expect(bookings[0]!.basePricePerMonth).toBe(40_000);
    expect(bookings[0]!.totalPrice).toBe(40_000);
  });

  test("смена даты напоминания сбрасывает дедуп Telegram-рассылки", async () => {
    const { db, bookings } = makeDb();
    const rt = runtimeWith(db);

    await createBooking(rt, user, input);
    // Дефолт напоминания для startDate 2026-05-05 / 1 мес → 2026-05-29.
    expect(bookings[0]!.reminderAt).toEqual(new Date("2026-05-29T00:00:00.000Z"));
    // Эмулируем, что дайджест уже ушёл.
    bookings[0]!.reminderNotifiedAt = new Date();

    // Правка с той же датой напоминания — флаг сохраняется.
    await updateBooking(rt, user, "b1", { ...input, reminderAt: "2026-05-29" });
    expect(bookings[0]!.reminderNotifiedAt).not.toBeNull();

    // Перенос напоминания — дедуп сбрасывается, уведомление перевзвесится.
    await updateBooking(rt, user, "b1", { ...input, reminderAt: "2026-05-30" });
    expect(bookings[0]!.reminderNotifiedAt).toBeNull();
  });
});

describe("listBookings search", () => {
  test("поиск покрывает причину служебной брони", async () => {
    let capturedWhere: any;
    const rt = runtimeWith({
      booking: {
        findMany: async ({ where }: any) => {
          capturedWhere = where;
          return [];
        },
        count: async () => 0,
      },
      $transaction: async (ops: any[]) => Promise.all(ops),
    });

    await listBookings(rt, { page: 1, pageSize: 20, search: "ремонт" } as any);

    const targets = (capturedWhere.OR ?? []).map((clause: any) => Object.keys(clause)[0]);
    expect(targets).toContain("serviceReason");
    expect(targets).toContain("brand");
    expect(targets).toContain("client");
  });
});
