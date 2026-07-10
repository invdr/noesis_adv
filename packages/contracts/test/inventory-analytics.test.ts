import { describe, expect, test } from "bun:test";
import {
  MAX_ANALYTICS_WINDOW_MONTHS,
  inventoryAnalyticsQuerySchema,
} from "../src/inventory-analytics";
import { publicAvailabilityQuerySchema } from "../src/public-availability";
import { addBookingMonths } from "../src/booking";

describe("inventoryAnalyticsQuerySchema", () => {
  test("требует from раньше to", () => {
    expect(
      inventoryAnalyticsQuerySchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-01",
      }).success,
    ).toBe(false);
  });

  test("окно ровно в потолок проходит", () => {
    const from = "2026-01-01";
    const to = addBookingMonths(from, MAX_ANALYTICS_WINDOW_MONTHS);
    expect(inventoryAnalyticsQuerySchema.safeParse({ from, to }).success).toBe(true);
  });

  test("окно больше потолка отклоняется", () => {
    const from = "2026-01-01";
    const to = addBookingMonths(from, MAX_ANALYTICS_WINDOW_MONTHS + 1);
    const res = inventoryAnalyticsQuerySchema.safeParse({ from, to });
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.path[0])).toContain("to");
  });

  test("публичная занятость наследует тот же потолок окна", () => {
    const from = "2026-01-01";
    const to = addBookingMonths(from, MAX_ANALYTICS_WINDOW_MONTHS + 1);
    expect(publicAvailabilityQuerySchema.safeParse({ from, to }).success).toBe(false);
  });
});
