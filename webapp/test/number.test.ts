import { describe, expect, test } from "bun:test";
import { parseOptionalNumberInput } from "../src/shared/number";

describe("parseOptionalNumberInput", () => {
  test("distinguishes blank and invalid values", () => {
    expect(parseOptionalNumberInput("")).toEqual({ value: null, error: null });
    expect(parseOptionalNumberInput("   ")).toEqual({ value: null, error: null });
    expect(parseOptionalNumberInput("42x").error).toBeTruthy();
  });

  test("accepts comma decimals and space thousands", () => {
    expect(parseOptionalNumberInput("2,5")).toEqual({ value: 2.5, error: null });
    expect(parseOptionalNumberInput("42 000")).toEqual({ value: 42000, error: null });
  });
});
