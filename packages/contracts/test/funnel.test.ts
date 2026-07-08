import { describe, expect, test } from "bun:test";
import {
  createFunnelSchema,
  updateFunnelSchema,
  reorderFunnelsSchema,
} from "../src/funnel";

describe("createFunnelSchema", () => {
  test("обрезает пробелы в названии", () => {
    expect(createFunnelSchema.parse({ name: "  Продажи  " }).name).toBe("Продажи");
  });

  test("отклоняет пустое название", () => {
    expect(() => createFunnelSchema.parse({ name: "   " })).toThrow();
  });
});

describe("updateFunnelSchema", () => {
  test("принимает переименование", () => {
    expect(updateFunnelSchema.parse({ name: "Аренда" }).name).toBe("Аренда");
  });

  test("принимает назначение воронкой по умолчанию", () => {
    expect(updateFunnelSchema.parse({ isDefault: true }).isDefault).toBe(true);
  });

  test("снять флаг по умолчанию напрямую нельзя", () => {
    expect(() => updateFunnelSchema.parse({ isDefault: false })).toThrow();
  });

  test("отклоняет пустой объект (нечего обновлять)", () => {
    expect(() => updateFunnelSchema.parse({})).toThrow();
  });
});

describe("reorderFunnelsSchema", () => {
  test("требует хотя бы один id", () => {
    expect(() => reorderFunnelsSchema.parse({ ids: [] })).toThrow();
  });
});
