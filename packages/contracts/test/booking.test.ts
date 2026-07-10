import { describe, expect, test } from "bun:test";
import {
  addBookingMonths,
  bookingDefaultTotal,
  defaultBookingReminder,
  upsertBookingSchema,
} from "../src/booking";

describe("booking date helpers", () => {
  test("плавающий месяц клампит 31-е число к концу месяца", () => {
    expect(addBookingMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addBookingMonths("2028-01-31", 1)).toBe("2028-02-29");
  });

  test("стык периодов строится как полуоткрытый интервал", () => {
    expect(addBookingMonths("2026-05-05", 1)).toBe("2026-06-05");
    expect(addBookingMonths("2026-05-05", 3)).toBe("2026-08-05");
  });

  test("дефолтное напоминание — за 7 дней до окончания", () => {
    expect(defaultBookingReminder("2026-08-05")).toBe("2026-07-29");
  });
});

describe("booking price helpers", () => {
  test("снимок цены по умолчанию = цена/мес × месяцы", () => {
    expect(bookingDefaultTotal(45_000, 3)).toBe(135_000);
  });

  test("цена по запросу остаётся без итога", () => {
    expect(bookingDefaultTotal(null, 3)).toBeNull();
  });
});

describe("upsertBookingSchema", () => {
  const base = {
    constructionId: "c1",
    startDate: "2026-05-05",
    durationMonths: 1,
    status: "booked" as const,
  };

  test("commercial требует клиента", () => {
    const res = upsertBookingSchema.safeParse({ ...base, kind: "commercial" });
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.path[0])).toContain(
      "clientId",
    );
  });

  test("service требует причину", () => {
    const res = upsertBookingSchema.safeParse({ ...base, kind: "service" });
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.path[0])).toContain(
      "serviceReasonId",
    );
  });

  test("валидная коммерческая бронь проходит", () => {
    expect(
      upsertBookingSchema.safeParse({
        ...base,
        kind: "commercial",
        clientId: "contact1",
        constructionSideId: "sideA",
      }).success,
    ).toBe(true);
  });

  test("нереальную календарную дату отклоняет", () => {
    expect(
      upsertBookingSchema.safeParse({
        ...base,
        kind: "commercial",
        clientId: "contact1",
        startDate: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(
      upsertBookingSchema.safeParse({
        ...base,
        kind: "commercial",
        clientId: "contact1",
        startDate: "2026-13-01",
      }).success,
    ).toBe(false);
  });

  test("legacy-код стороны ещё принимается как fallback", () => {
    expect(
      upsertBookingSchema.safeParse({
        ...base,
        kind: "commercial",
        clientId: "contact1",
        side: "C",
      }).success,
    ).toBe(true);
  });
});
