import { productToday } from "../shared/date";

/** Форматирование суммы в рублях. */
export function rub(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

/** Разбор суммы из строки («42 000», «42000,50») → целые рубли или null. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** Текущий месяц (ГГГГ-ММ) в продуктовой таймзоне. */
export function currentMonth(): string {
  return productToday().slice(0, 7);
}

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** «2026-07» → «Июль 2026». */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return `${MONTH_NAMES[m - 1] ?? m} ${y}`;
}

/** Доля bps → строка процента для инпута («3333» → «33.33»). */
export function bpsToPercent(bps: number): string {
  return String(bps / 100);
}

/** Процент из строки → bps целым («33,33» → 3333) или null. */
export function percentToBps(pct: string): number | null {
  const cleaned = pct.replace(",", ".").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Проценты из bps для показа («3333» → «33.33%»). */
export function percentLabel(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
}

/** Месяц на `n` назад: («2026-01», 2) → «2025-11». */
export function backMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const zero = y! * 12 + (m! - 1) - n;
  const year = Math.floor(zero / 12);
  const mm = (zero % 12) + 1;
  return `${year}-${String(mm).padStart(2, "0")}`;
}
