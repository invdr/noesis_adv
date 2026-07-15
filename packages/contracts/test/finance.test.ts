import { describe, expect, test } from "bun:test";
import {
  allocateByShares,
  monthOfDate,
  monthStart,
  nextMonth,
  shareActiveInMonth,
  upsertFinanceParticipantSchema,
} from "../src/finance";

describe("allocateByShares", () => {
  test("делит поровну при 100% долей", () => {
    const out = allocateByShares(100, [
      { shareBps: 5000 },
      { shareBps: 5000 },
    ]);
    expect(out.map((o) => o.amount)).toEqual([50, 50]);
  });

  test("сумма всегда равна net при Σ=100% (три доли 33.33/33.33/33.34)", () => {
    const out = allocateByShares(100, [
      { shareBps: 3333 },
      { shareBps: 3333 },
      { shareBps: 3334 },
    ]);
    expect(out.reduce((a, o) => a + o.amount, 0)).toBe(100);
    // Остаток достаётся наибольшей доле.
    expect(out[2]!.amount).toBe(34);
  });

  test("нечётный net распределяется без потери копеек", () => {
    const out = allocateByShares(101, [{ shareBps: 5000 }, { shareBps: 5000 }]);
    expect(out.reduce((a, o) => a + o.amount, 0)).toBe(101);
  });

  test("отрицательный net (убыток) делится по долям", () => {
    const out = allocateByShares(-101, [{ shareBps: 5000 }, { shareBps: 5000 }]);
    expect(out.reduce((a, o) => a + o.amount, 0)).toBe(-101);
  });

  test("частичные доли (Σ<100%) разносят только свою часть", () => {
    const out = allocateByShares(100, [{ shareBps: 5000 }]);
    expect(out[0]!.amount).toBe(50);
  });

  test("пустой список долей — пусто", () => {
    expect(allocateByShares(100, [])).toEqual([]);
  });
});

describe("хелперы месяцев", () => {
  test("nextMonth переходит через год", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(nextMonth("2026-07")).toBe("2026-08");
  });

  test("monthOfDate и monthStart", () => {
    expect(monthOfDate("2026-07-15")).toBe("2026-07");
    expect(monthStart("2026-07")).toBe("2026-07-01");
  });

  test("shareActiveInMonth — полуоткрытый интервал", () => {
    expect(shareActiveInMonth({ startMonth: "2026-01", endMonth: null }, "2026-05")).toBe(true);
    expect(shareActiveInMonth({ startMonth: "2026-01", endMonth: null }, "2025-12")).toBe(false);
    expect(shareActiveInMonth({ startMonth: "2026-01", endMonth: "2026-06" }, "2026-05")).toBe(true);
    // Конец исключается.
    expect(shareActiveInMonth({ startMonth: "2026-01", endMonth: "2026-06" }, "2026-06")).toBe(false);
    expect(shareActiveInMonth({ startMonth: "2026-01", endMonth: "2026-06" }, "2026-01")).toBe(true);
  });
});

describe("upsertFinanceParticipantSchema", () => {
  const base = { name: "Инвестор", kind: "investor" as const };

  test("непересекающиеся доли валидны", () => {
    const res = upsertFinanceParticipantSchema.safeParse({
      ...base,
      shares: [
        { shareBps: 5000, startMonth: "2026-01", endMonth: "2026-06" },
        { shareBps: 6000, startMonth: "2026-06", endMonth: null },
      ],
    });
    expect(res.success).toBe(true);
  });

  test("пересекающиеся доли отклоняются", () => {
    const res = upsertFinanceParticipantSchema.safeParse({
      ...base,
      shares: [
        { shareBps: 5000, startMonth: "2026-01", endMonth: "2026-06" },
        { shareBps: 6000, startMonth: "2026-05", endMonth: null },
      ],
    });
    expect(res.success).toBe(false);
  });

  test("конец периода не позже начала — ошибка", () => {
    const res = upsertFinanceParticipantSchema.safeParse({
      ...base,
      shares: [{ shareBps: 5000, startMonth: "2026-06", endMonth: "2026-06" }],
    });
    expect(res.success).toBe(false);
  });

  test("доля вне диапазона (>100%) отклоняется", () => {
    const res = upsertFinanceParticipantSchema.safeParse({
      ...base,
      shares: [{ shareBps: 10001, startMonth: "2026-01", endMonth: null }],
    });
    expect(res.success).toBe(false);
  });

  test("пустой таймлайн долей допустим", () => {
    const res = upsertFinanceParticipantSchema.safeParse({ ...base, shares: [] });
    expect(res.success).toBe(true);
  });
});
