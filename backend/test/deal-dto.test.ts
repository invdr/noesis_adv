import { describe, expect, test } from "bun:test";
import { toDealBookingSummary, type DealBookingRow } from "../src/leads/deal-dto";

function bookingRow(over: Partial<DealBookingRow> = {}): DealBookingRow {
  return {
    id: "b1",
    kind: "commercial",
    status: "booked",
    constructionId: "c1",
    constructionSideId: "sideA",
    clientId: null,
    serviceReasonId: null,
    brandId: null,
    campaignNote: null,
    leadId: "lead1",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-08-01T00:00:00.000Z"),
    durationMonths: 1,
    basePricePerMonth: 45000,
    totalPrice: 45000,
    priceNote: null,
    reminderAt: null,
    reminderNotifiedAt: null,
    managerId: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    construction: { name: "СФ-1", code: "СФ-001" },
    constructionSide: { code: "A" },
    ...over,
  } as DealBookingRow;
}

describe("toDealBookingSummary", () => {
  test("endDate инклюзивный, поля брони сведены", () => {
    const s = toDealBookingSummary(bookingRow());
    expect(s.startDate).toBe("2026-07-01");
    expect(s.endDate).toBe("2026-07-31"); // хранится 2026-08-01 (эксклюзивно)
    expect(s.constructionCode).toBe("СФ-001");
    expect(s.sideCode).toBe("A");
    expect(s.totalPrice).toBe(45000);
    expect(s.status).toBe("booked");
  });

  test("служебная бронь без цены — totalPrice null", () => {
    const s = toDealBookingSummary(bookingRow({ kind: "service", totalPrice: null }));
    expect(s.kind).toBe("service");
    expect(s.totalPrice).toBeNull();
  });
});
