import type { AnalyticsResponse } from "@noesis/contracts";
import { sourceLabel } from "../leads/shared";

/** Экранирование ячейки CSV (RFC 4180) + нейтрализация формул Excel. */
function cell(value: string | number): string {
  const s = String(value);
  const defanged = /^[=@+\-]/.test(s) && !/^[+-]?[\d.,]+%?$/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(defanged) ? `"${defanged.replace(/"/g, '""')}"` : defanged;
}

const row = (...cells: (string | number)[]): string => cells.map(cell).join(",");

/**
 * Сводка дашборда аналитики в CSV (секции с пустой строкой между ними).
 * UTF-8 BOM добавляет вызывающий код при скачивании.
 */
export function analyticsToCsv(data: AnalyticsResponse): string {
  const lines: string[] = [];
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  lines.push(row("Период", `${data.from.slice(0, 10)} — ${data.to.slice(0, 10)}`));
  lines.push("");
  lines.push(row("Итоги", ""));
  lines.push(row("Всего заявок", data.total));
  lines.push(row("Сделок (won)", data.conversion.won));
  lines.push(row("Отказов (lost)", data.conversion.lost));
  lines.push(row("В работе", data.conversion.inProgress));
  lines.push(row("Конверсия в сделку", pct(data.conversion.wonRate)));
  lines.push(row("Доля закрытий в плюс", pct(data.conversion.closeRate)));

  lines.push("");
  lines.push(row("По этапам", "Заявок"));
  for (const s of data.byStage) lines.push(row(s.name, s.count));

  lines.push("");
  lines.push(row("По источникам", "Заявок"));
  for (const s of data.bySource) lines.push(row(s.name ?? sourceLabel(s.source), s.count));

  lines.push("");
  lines.push(row("По ЖК", "Заявок"));
  for (const p of data.byProject) lines.push(row(p.name, p.count));

  lines.push("");
  lines.push(row("По менеджерам", "Заявок", "Сделок", "Контактов"));
  for (const m of data.byManager) {
    lines.push(row(m.name || m.email || "Не распределено", m.leads, m.won, m.contacts));
  }

  lines.push("");
  lines.push(row("Неделя", "Создано", "Сделки", "Отказы"));
  for (const w of data.weekly) lines.push(row(w.weekStart, w.created, w.won, w.lost));

  return lines.join("\r\n");
}

/** Скачивание CSV-файла в браузере (BOM — чтобы Excel распознал UTF-8). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
