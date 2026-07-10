import { describe, expect, test } from "bun:test";
import {
  displayInclusivePeriod,
  monthStart,
  previousDateOnly,
  productToday,
  shiftDateOnly,
} from "../src/shared/date";

describe("shared date helpers", () => {
  test("productToday uses product timezone instead of UTC calendar day", () => {
    expect(productToday(new Date("2026-06-30T22:30:00.000Z"))).toBe("2026-07-01");
    expect(monthStart(productToday(new Date("2026-07-31T22:30:00.000Z")))).toBe("2026-08-01");
  });

  test("date-only shifts and inclusive display stay safe for empty values", () => {
    expect(shiftDateOnly("", 1)).toBe("");
    expect(previousDateOnly("2026-08-01")).toBe("2026-07-31");
    expect(displayInclusivePeriod("2026-07-01", "2026-08-01")).toBe("2026-07-01–2026-07-31");
  });
});
