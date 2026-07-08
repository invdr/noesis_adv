import { describe, expect, test } from "bun:test";
import {
  upsertContactTypeSchema,
  reorderContactTypesSchema,
} from "../src/contact-type";

describe("upsertContactTypeSchema", () => {
  test("обрезает пробелы в названии", () => {
    expect(upsertContactTypeSchema.parse({ name: "  Звонок  " }).name).toBe("Звонок");
  });

  test("отклоняет пустое название", () => {
    expect(() => upsertContactTypeSchema.parse({ name: "  " })).toThrow();
  });

  test("отклоняет название длиннее 40 символов", () => {
    expect(() => upsertContactTypeSchema.parse({ name: "я".repeat(41) })).toThrow();
  });
});

describe("reorderContactTypesSchema", () => {
  test("требует хотя бы один id", () => {
    expect(() => reorderContactTypesSchema.parse({ ids: [] })).toThrow();
  });
});
