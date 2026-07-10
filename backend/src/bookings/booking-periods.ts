import type { BusyInterval, OccupancyStatus } from "@noesis/contracts";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface PeriodRange {
  startDate: Date;
  endDate: Date;
}

export interface ClippedRange {
  start: Date;
  end: Date;
  days: number;
}

export function dateOnlyToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS));
}

export function previousDateOnly(exclusiveEnd: Date): string {
  return toDateOnly(new Date(exclusiveEnd.getTime() - DAY_MS));
}

export function overlap(
  range: PeriodRange,
  from: Date,
  to: Date,
): ClippedRange | null {
  const start = range.startDate > from ? range.startDate : from;
  const end = range.endDate < to ? range.endDate : to;
  const days = daysBetween(start, end);
  return days > 0 ? { start, end, days } : null;
}

export function mergeOverlaps(
  ranges: PeriodRange[],
  from: Date,
  to: Date,
): { occupiedDays: number; busyIntervals: BusyInterval[] } {
  const clipped = ranges
    .map((range) => overlap(range, from, to))
    .filter((range): range is ClippedRange => range !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: { start: Date; end: Date }[] = [];
  for (const range of clipped) {
    const last = merged.at(-1);
    if (last && range.start.getTime() <= last.end.getTime()) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }

  return {
    occupiedDays: merged.reduce(
      (sum, range) => sum + daysBetween(range.start, range.end),
      0,
    ),
    busyIntervals: merged.map((range) => ({
      startDate: toDateOnly(range.start),
      endDate: previousDateOnly(range.end),
    })),
  };
}

export function occupancyStatus(
  occupiedDays: number,
  totalDays: number,
): OccupancyStatus {
  if (occupiedDays === 0) return "free";
  return occupiedDays >= totalDays ? "occupied" : "partiallyOccupied";
}

