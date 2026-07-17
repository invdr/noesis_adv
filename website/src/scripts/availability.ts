import type { OccupancyStatus } from "@noesis/contracts";

/* Единый источник правила агрегации занятости и текстов статусов для
   сайт-скриптов (каталог, главная). Значения UiStatus — контракт data-state
   для CSS и цветов маркеров. */

export type { OccupancyStatus };

export type UiStatus = "free" | "partial" | "occupied";

/* Продуктовое правило (решение №10): нет данных о сторонах или есть полностью
   свободная сторона → «свободна»; все стороны заняты → «занята»; иначе —
   «частично». */
export function aggregateSides(sides: readonly { status: OccupancyStatus }[]): UiStatus {
  if (!sides.length || sides.some((side) => side.status === "free")) return "free";
  if (sides.every((side) => side.status === "occupied")) return "occupied";
  return "partial";
}

export const CONSTRUCTION_STATUS_TEXT: Record<UiStatus, string> = {
  free: "Есть свободная сторона",
  partial: "Частично занято",
  occupied: "Все стороны заняты",
};

/* Короткое слово статуса стороны для строк вида «A: свободно · B: занято». */
export function sideStatusShort(status: OccupancyStatus): string {
  if (status === "free") return "свободно";
  if (status === "occupied") return "занято";
  return "частично";
}
