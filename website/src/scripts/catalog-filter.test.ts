import { describe, expect, test } from "bun:test";
import type { CatalogItem } from "../lib/api";
import {
  matchesCatalogFilters,
  type CatalogAvailability,
  type CatalogFilters,
} from "./catalog-filter";

/**
 * Правила фильтра каталога. Логика цены — продуктовая: до извлечения она жила
 * внутри 479-строчного замыкания страницы и проверить её было нечем.
 */

const NO_FILTERS: CatalogFilters = {
  from: "2026-08-01",
  to: "2026-08-31",
  format: "",
  district: "",
  lighting: "",
  sideCount: "",
  priceFrom: null,
  priceTo: null,
  onlyFree: false,
};

function side(over: Partial<CatalogItem["sides"][number]> = {}) {
  return {
    id: "s1",
    code: "A",
    effectivePricePerMonth: 30_000,
    priceLabel: "30 000 ₽/мес",
    description: null,
    trafficPerDay: null,
    grp: null,
    ...over,
  } as CatalogItem["sides"][number];
}

function item(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "c1",
    slug: "sf-014",
    name: "СФ-014",
    code: "СФ-014",
    address: "пр. Путина, 1",
    district: "Ленинский",
    lat: 43.3169,
    lng: 45.6981,
    format: "cityFormat",
    formatLabel: "Сити-формат",
    lighting: "internal",
    sideCount: 2,
    sideLabel: "Двусторонняя (A/B)",
    pricePerMonth: 30_000,
    priceLabel: "30 000 ₽/мес",
    img: "/assets/x.png",
    sizeLabel: "1,2 × 1,8 м",
    lightingLabel: "Внутренняя",
    reachLabel: "12 000 чел./день",
    href: "/constructions/sf-014",
    isSoon: false,
    badges: [],
    sides: [side()],
    ...over,
  } as CatalogItem;
}

/** Заглушка занятости: карта id → статус. */
function availability(entries: Record<string, "free" | "partial" | "occupied">): CatalogAvailability {
  const map = new Map(Object.entries(entries).map(([id, status]) => [id, { status }]));
  return { get: (id: string) => map.get(id) };
}

describe("простые фильтры", () => {
  test("без фильтров проходит всё", () => {
    expect(matchesCatalogFilters(item(), NO_FILTERS, null)).toBe(true);
  });

  test("формат, район, подсветка и число сторон отсеивают несовпадения", () => {
    const it = item();
    expect(matchesCatalogFilters(it, { ...NO_FILTERS, format: "billboard" }, null)).toBe(false);
    expect(matchesCatalogFilters(it, { ...NO_FILTERS, district: "Октябрьский" }, null)).toBe(false);
    expect(matchesCatalogFilters(it, { ...NO_FILTERS, lighting: "none" }, null)).toBe(false);
    // sideCount приходит из формы строкой — сравнение через Number.
    expect(matchesCatalogFilters(it, { ...NO_FILTERS, sideCount: "3" }, null)).toBe(false);
    expect(matchesCatalogFilters(it, { ...NO_FILTERS, sideCount: "2" }, null)).toBe(true);
  });
});

describe("правило цены", () => {
  test("проходит, если в диапазон попала хотя бы одна сторона", () => {
    const it = item({
      sides: [
        side({ id: "a", effectivePricePerMonth: 90_000 }),
        side({ id: "b", effectivePricePerMonth: 30_000 }),
      ],
    });

    // Дорогая сторона вне диапазона, но дешёвая — внутри: позиция проходит.
    expect(
      matchesCatalogFilters(it, { ...NO_FILTERS, priceFrom: 20_000, priceTo: 40_000 }, null),
    ).toBe(true);
  });

  test("не проходит, если ни одна сторона не попала", () => {
    const it = item({
      sides: [
        side({ id: "a", effectivePricePerMonth: 90_000 }),
        side({ id: "b", effectivePricePerMonth: 80_000 }),
      ],
    });

    expect(
      matchesCatalogFilters(it, { ...NO_FILTERS, priceFrom: 20_000, priceTo: 40_000 }, null),
    ).toBe(false);
  });

  test("цена конструкции подставляется, только когда цены нет НИ У ОДНОЙ стороны", () => {
    const noSidePrices = item({
      pricePerMonth: 30_000,
      sides: [side({ effectivePricePerMonth: null })],
    });
    expect(
      matchesCatalogFilters(noSidePrices, { ...NO_FILTERS, priceFrom: 20_000, priceTo: 40_000 }, null),
    ).toBe(true);

    // А здесь у одной стороны цена есть — подстановки нет, и 30 000 с
    // конструкции в расчёт не идут: остаётся только 90 000, вне диапазона.
    const oneSidePriced = item({
      pricePerMonth: 30_000,
      sides: [
        side({ id: "a", effectivePricePerMonth: 90_000 }),
        side({ id: "b", effectivePricePerMonth: null }),
      ],
    });
    expect(
      matchesCatalogFilters(oneSidePriced, { ...NO_FILTERS, priceFrom: 20_000, priceTo: 40_000 }, null),
    ).toBe(false);
  });

  test("«цена по запросу» при заданном диапазоне отсеивается — так и задумано", () => {
    const onRequest = item({
      pricePerMonth: null,
      sides: [side({ effectivePricePerMonth: null })],
    });

    expect(
      matchesCatalogFilters(onRequest, { ...NO_FILTERS, priceFrom: 20_000 }, null),
    ).toBe(false);
    // Без диапазона она видна как обычно.
    expect(matchesCatalogFilters(onRequest, NO_FILTERS, null)).toBe(true);
  });

  test("границы работают по отдельности и включительно", () => {
    const it = item({ sides: [side({ effectivePricePerMonth: 30_000 })] });

    expect(matchesCatalogFilters(it, { ...NO_FILTERS, priceFrom: 30_000 }, null)).toBe(true);
    expect(matchesCatalogFilters(it, { ...NO_FILTERS, priceTo: 30_000 }, null)).toBe(true);
    expect(matchesCatalogFilters(it, { ...NO_FILTERS, priceFrom: 30_001 }, null)).toBe(false);
    expect(matchesCatalogFilters(it, { ...NO_FILTERS, priceTo: 29_999 }, null)).toBe(false);
  });
});

describe("фильтр «только свободные»", () => {
  test("оставляет только позиции со статусом free", () => {
    const free = item({ id: "free" });
    const partial = item({ id: "partial" });
    const av = availability({ free: "free", partial: "partial" });
    const filters = { ...NO_FILTERS, onlyFree: true };

    expect(matchesCatalogFilters(free, filters, av)).toBe(true);
    expect(matchesCatalogFilters(partial, filters, av)).toBe(false);
  });

  test("позиция без записи о занятости не считается свободной", () => {
    const filters = { ...NO_FILTERS, onlyFree: true };
    expect(matchesCatalogFilters(item({ id: "unknown" }), filters, availability({}))).toBe(false);
  });

  test("выключённый фильтр не смотрит на занятость вовсе", () => {
    // Вызывающая сторона гасит onlyFree, пока занятость не загружена; проверяем,
    // что в этом режиме отсутствие данных ничего не отсеивает.
    expect(matchesCatalogFilters(item(), NO_FILTERS, null)).toBe(true);
  });
});
