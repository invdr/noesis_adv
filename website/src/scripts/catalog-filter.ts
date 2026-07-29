import type { CatalogItem } from "../lib/api";
import type { UiStatus } from "./availability";

/**
 * Фильтры каталога, как их собирает форма страницы `/catalog`.
 *
 * `from`/`to` задают период занятости и в предикате не участвуют: занятость
 * приходит отдельным запросом и попадает сюда уже посчитанной.
 */
export interface CatalogFilters {
  from: string;
  to: string;
  format: string;
  district: string;
  lighting: string;
  sideCount: string;
  priceFrom: number | null;
  priceTo: number | null;
  onlyFree: boolean;
}

/** Занятость позиции на выбранный период (то, что нужно предикату). */
export interface CatalogAvailability {
  get(id: string): { status: UiStatus } | undefined;
}

/**
 * Подходит ли позиция под выбранные фильтры.
 *
 * Вынесено из замыкания страницы, чтобы правило цены можно было проверить
 * тестом: это продуктовая логика, а не деталь вёрстки. Занятость передаётся
 * параметром (`null` — данных ещё нет).
 *
 * Правила, которые легко потерять при правке:
 *
 * 1. Позиция проходит по цене, если в диапазон попала ХОТЯ БЫ ОДНА цена
 *    стороны — а не все и не средняя.
 * 2. Цена конструкции подставляется, только если НИ У ОДНОЙ стороны цены нет.
 *    Это не поштучный доliv: у стороны без цены, когда у соседней цена есть,
 *    подстановки не происходит.
 * 3. «Цена по запросу» (ни у сторон, ни у конструкции цены нет) при заданном
 *    диапазоне отсеивается. Это осознанное решение, а не баг: пользователь
 *    просил конкретный бюджет.
 * 4. Нестрогое `!=` у границ намеренно покрывает и `null`, и `undefined`.
 *
 * `onlyFree` вызывающая сторона обязана гасить, пока занятости нет
 * (`onlyFree: checked && availability !== null`) — иначе фильтр отсеет всё.
 */
export function matchesCatalogFilters(
  item: CatalogItem,
  active: CatalogFilters,
  availability: CatalogAvailability | null,
): boolean {
  if (active.format && item.format !== active.format) return false;
  if (active.district && item.district !== active.district) return false;
  if (active.lighting && item.lighting !== active.lighting) return false;
  if (active.sideCount && item.sideCount !== Number(active.sideCount)) return false;
  if (active.priceFrom != null || active.priceTo != null) {
    const prices = item.sides
      .map((side) => side.effectivePricePerMonth)
      .filter((price): price is number => typeof price === "number");
    if (!prices.length && item.pricePerMonth != null) prices.push(item.pricePerMonth);
    if (
      !prices.some(
        (price) =>
          (active.priceFrom == null || price >= active.priceFrom) &&
          (active.priceTo == null || price <= active.priceTo),
      )
    ) {
      return false;
    }
  }
  if (active.onlyFree && availability?.get(item.id)?.status !== "free") return false;
  return true;
}
