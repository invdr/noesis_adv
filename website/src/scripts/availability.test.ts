import { describe, expect, test } from "bun:test";
import { aggregateSides, CONSTRUCTION_STATUS_TEXT, sideStatusShort } from "./availability";

const side = (status: "free" | "partiallyOccupied" | "occupied") => ({ status });

describe("aggregateSides — продуктовое правило агрегата занятости (решение №10)", () => {
  test("нет данных о сторонах → свободна", () => {
    expect(aggregateSides([])).toBe("free");
  });

  test("все стороны свободны → свободна", () => {
    expect(aggregateSides([side("free"), side("free")])).toBe("free");
  });

  test("хотя бы одна полностью свободная сторона → свободна", () => {
    expect(aggregateSides([side("occupied"), side("free"), side("partiallyOccupied")])).toBe("free");
  });

  test("занятые и частично занятые без свободной → частично", () => {
    expect(aggregateSides([side("occupied"), side("partiallyOccupied")])).toBe("partial");
    expect(aggregateSides([side("partiallyOccupied")])).toBe("partial");
  });

  test("все стороны заняты → занята", () => {
    expect(aggregateSides([side("occupied"), side("occupied")])).toBe("occupied");
  });
});

describe("тексты статусов", () => {
  test("подписи агрегата конструкции и ключи (контракт data-state)", () => {
    expect(CONSTRUCTION_STATUS_TEXT).toEqual({
      free: "Есть свободная сторона",
      partial: "Частично занято",
      occupied: "Все стороны заняты",
    });
  });

  test("короткое слово статуса стороны", () => {
    expect(sideStatusShort("free")).toBe("свободно");
    expect(sideStatusShort("partiallyOccupied")).toBe("частично");
    expect(sideStatusShort("occupied")).toBe("занято");
  });
});
