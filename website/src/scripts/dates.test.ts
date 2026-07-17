import { describe, expect, test } from "bun:test";
import { addDays, addMonthsClamped, defaultPeriod, minPeriodEnd } from "./dates";

describe("addMonthsClamped", () => {
  test("обычная дата сдвигается на месяц день-в-день", () => {
    expect(addMonthsClamped("2026-07-17", 1)).toBe("2026-08-17");
    expect(addMonthsClamped("2026-05-05", 1)).toBe("2026-06-05");
  });

  test("конец месяца клампится (31.01 + 1 мес → 28.02)", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
  });

  test("переход через год", () => {
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
  });

  test("високосный февраль", () => {
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
  });
});

describe("defaultPeriod", () => {
  const today = "2026-07-17";

  test("пустая пара → сегодня и +1 месяц", () => {
    expect(defaultPeriod("", "", today)).toEqual({ from: "2026-07-17", to: "2026-08-17" });
  });

  test("заданное начало сохраняется, окончание = минимум месяца", () => {
    expect(defaultPeriod("2026-09-01", "", today)).toEqual({ from: "2026-09-01", to: "2026-10-01" });
  });

  test("окончание короче месяца подтягивается к минимуму", () => {
    expect(defaultPeriod("2026-09-01", "2026-09-15", today)).toEqual({ from: "2026-09-01", to: "2026-10-01" });
  });

  test("окончание длиннее месяца не трогаем", () => {
    expect(defaultPeriod("2026-09-01", "2026-12-01", today)).toEqual({ from: "2026-09-01", to: "2026-12-01" });
  });

  test("minPeriodEnd совпадает с +1 месяц", () => {
    expect(minPeriodEnd("2026-01-31")).toBe("2026-02-28");
  });

  test("addDays остаётся дневным сдвигом (эксклюзивная граница API)", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });
});
