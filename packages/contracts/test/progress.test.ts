import { describe, expect, test } from "bun:test";
import {
  compareProgressDesc,
  progressPeriodLabel,
  upsertProgressAlbumSchema,
} from "../src/progress";

describe("progressPeriodLabel", () => {
  test("месяц по-русски + год", () => {
    expect(progressPeriodLabel(2026, 6)).toBe("Июнь 2026");
    expect(progressPeriodLabel(2025, 12)).toBe("Декабрь 2025");
  });

  test("некорректный месяц → числовой фолбэк", () => {
    expect(progressPeriodLabel(2026, 13)).toBe("13/2026");
  });
});

describe("compareProgressDesc", () => {
  test("от новых месяцев к старым", () => {
    const albums = [
      { year: 2025, month: 12 },
      { year: 2026, month: 3 },
      { year: 2026, month: 1 },
    ].sort(compareProgressDesc);
    expect(albums).toEqual([
      { year: 2026, month: 3 },
      { year: 2026, month: 1 },
      { year: 2025, month: 12 },
    ]);
  });
});

describe("upsertProgressAlbumSchema", () => {
  test("валидный период проходит, месяц вне 1–12 — нет", () => {
    expect(upsertProgressAlbumSchema.safeParse({ year: 2026, month: 6 }).success).toBe(true);
    expect(upsertProgressAlbumSchema.safeParse({ year: 2026, month: 0 }).success).toBe(false);
    expect(upsertProgressAlbumSchema.safeParse({ year: 1990, month: 6 }).success).toBe(false);
  });
});
