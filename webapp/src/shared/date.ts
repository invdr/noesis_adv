export const DAY_MS = 24 * 60 * 60 * 1000;

// Бизнес-география продукта живет в московском времени, без летнего перевода.
export const PRODUCT_TIMEZONE_OFFSET_MINUTES = 3 * 60;

export function productToday(
  now: Date = new Date(),
  offsetMinutes = PRODUCT_TIMEZONE_OFFSET_MINUTES,
): string {
  return new Date(now.getTime() + offsetMinutes * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function monthStart(value: string): string {
  return value ? `${value.slice(0, 8)}01` : "";
}

export function dateOnlyMs(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

export function shiftDateOnly(value: string, days: number): string {
  const time = dateOnlyMs(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time + days * DAY_MS).toISOString().slice(0, 10);
}

export function previousDateOnly(value: string): string {
  return shiftDateOnly(value, -1);
}

export function displayInclusivePeriod(startDate: string, exclusiveEndDate: string): string {
  const inclusiveEnd = previousDateOnly(exclusiveEndDate);
  return startDate && inclusiveEnd ? `${startDate}–${inclusiveEnd}` : "выберите период";
}
