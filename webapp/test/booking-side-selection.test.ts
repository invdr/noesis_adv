import { describe, expect, test } from "bun:test";
import {
  nextBookingSideId,
  selectedBookingSide,
} from "../src/bookings/BookingsView";

const sideA = { id: "sideA", code: "A" };
const sideB = { id: "sideB", code: "B" };

describe("booking side selection helpers", () => {
  test("one-sided construction technically selects A", () => {
    const construction = { sideCount: 1 as const, sides: [sideA] as any };

    expect(nextBookingSideId(construction, "")).toBe("sideA");
    expect(selectedBookingSide(construction, "")?.id).toBe("sideA");
  });

  test("multi-sided construction requires explicit side choice", () => {
    const construction = { sideCount: 2 as const, sides: [sideA, sideB] as any };

    expect(nextBookingSideId(construction, "")).toBe("");
    expect(nextBookingSideId(construction, "missing")).toBe("");
    expect(selectedBookingSide(construction, "")).toBeNull();
  });
});
