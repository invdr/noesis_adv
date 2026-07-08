import { describe, expect, test } from "bun:test";
import { phoneInputError } from "../src/ui/phone";

describe("phone input validation", () => {
  test("allows optional international partner phones without Russian mask validation", () => {
    expect(phoneInputError("+1 555 123 4567")).toBe("");
    expect(phoneInputError("+44 20 7946 0958")).toBe("");
  });

  test("rejects text and incomplete international partner phones", () => {
    expect(phoneInputError("позвонить после 18")).not.toBe("");
    expect(phoneInputError("+1 55")).not.toBe("");
  });

  test("still validates required client phone as Russian number", () => {
    expect(phoneInputError("+1 555 123 4567", true)).not.toBe("");
    expect(phoneInputError("+7 (928) 000-00-00", true)).toBe("");
  });
});
