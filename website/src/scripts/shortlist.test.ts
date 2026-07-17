import { describe, expect, test } from "bun:test";
import { normalizeShortlist, shortlistLeadText, sortSideCodes, type ShortlistItem } from "./shortlist";

const TODAY = "2026-07-17";

const base = {
  constructionId: "c1",
  slug: "siti-format",
  name: "Сити-формат",
  code: "СФ-001",
  address: "пр. Путина, 1",
  image: "",
  sides: [
    { code: "A", label: "Сторона A", priceLabel: "42 000 ₽/мес" },
    { code: "B", label: "Сторона B", priceLabel: "Цена по запросу" },
  ],
  from: "2026-08-01",
  to: "2026-09-01",
  priceLabel: "42 000 ₽/мес",
};

describe("normalizeShortlist", () => {
  test("новая модель sideCodes проходит как есть", () => {
    const items = normalizeShortlist([{ ...base, sideCodes: ["B", "A"] }], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]?.sideCodes).toEqual(["A", "B"]);
  });

  test("легаси sideCode мигрирует в sideCodes", () => {
    const items = normalizeShortlist([{ ...base, sideCode: "B" }], TODAY);
    expect(items[0]?.sideCodes).toEqual(["B"]);
  });

  test("легаси-дубли одной конструкции сливаются в одну позицию", () => {
    const items = normalizeShortlist(
      [{ ...base, sideCode: "A" }, { ...base, sideCode: "B" }],
      TODAY,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.sideCodes).toEqual(["A", "B"]);
  });

  test("пустой период автозаполняется: сегодня и +1 месяц", () => {
    const items = normalizeShortlist([{ ...base, sideCodes: ["A"], from: "", to: "" }], TODAY);
    expect(items[0]?.from).toBe("2026-07-17");
    expect(items[0]?.to).toBe("2026-08-17");
  });

  test("период короче месяца подтягивается к минимуму", () => {
    const items = normalizeShortlist(
      [{ ...base, sideCodes: ["A"], from: "2026-08-01", to: "2026-08-10" }],
      TODAY,
    );
    expect(items[0]?.to).toBe("2026-09-01");
  });

  test("записи без валидных сторон отбрасываются", () => {
    expect(normalizeShortlist([{ ...base, sideCodes: [] }], TODAY)).toHaveLength(0);
    expect(normalizeShortlist([{ ...base, sideCodes: ["X"] }], TODAY)).toHaveLength(0);
  });
});

describe("shortlistLeadText", () => {
  test("несколько сторон — перечисление и цены по сторонам", () => {
    const item = { ...base, sideCodes: ["A", "B"] } as ShortlistItem;
    const text = shortlistLeadText([item]);
    expect(text).toContain("стороны A, B");
    expect(text).toContain("A: 42 000 ₽/мес · B: Цена по запросу");
  });

  test("одна сторона — прежний формат", () => {
    const item = { ...base, sideCodes: ["A"] } as ShortlistItem;
    const text = shortlistLeadText([item]);
    expect(text).toContain("сторона A");
    expect(text).toContain("42 000 ₽/мес");
  });
});

describe("sortSideCodes", () => {
  test("уникализация и порядок A→B→C", () => {
    expect(sortSideCodes(["C", "A", "C", "B"])).toEqual(["A", "B", "C"]);
  });
});
