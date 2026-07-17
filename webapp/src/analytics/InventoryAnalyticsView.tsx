import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addBookingMonths, type InventoryAnalyticsResponse } from "@noesis/contracts";
import { api } from "../api/client";
import { monthStart, productToday, shiftDateOnly } from "../shared/date";

const STATUS_LABEL: Record<string, string> = {
  free: "Свободна",
  partiallyOccupied: "Частично занята",
  occupied: "Занята",
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function rub(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

function compactIntervals(intervals: { startDate: string; endDate: string }[]): string {
  if (intervals.length === 0) return "нет";
  return intervals.map((i) => `${i.startDate}–${i.endDate}`).join(", ");
}

function statCards(data: InventoryAnalyticsResponse) {
  return [
    { label: "Загрузка", value: percent(data.occupancyRate) },
    { label: "Плановая выручка", value: rub(data.plannedRevenue) },
    { label: "Свободные стороны", value: String(data.freeSides) },
    { label: "Брони без цены", value: String(data.bookingsWithoutPrice) },
  ];
}

export function InventoryAnalyticsView() {
  const start = monthStart(productToday());
  const [from, setFrom] = useState(start);
  const [toInclusive, setToInclusive] = useState(shiftDateOnly(addBookingMonths(start, 1), -1));
  const to = useMemo(() => shiftDateOnly(toInclusive, 1), [toInclusive]);
  const hasValidWindow = Boolean(from && to && from < to);

  const analytics = useQuery({
    queryKey: ["inventory-analytics", from, to],
    queryFn: () => api.inventoryAnalytics({ from, to }),
    enabled: hasValidWindow,
  });

  const setWindow = (startDate: string, months: number) => {
    setFrom(startDate);
    setToInclusive(shiftDateOnly(addBookingMonths(startDate, months), -1));
  };

  return (
    <section>
      <div className="toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={toInclusive} onChange={(e) => setToInclusive(e.target.value)} />
        <button type="button" className="btn-sm" onClick={() => setWindow(monthStart(productToday()), 1)}>
          текущий месяц
        </button>
        <button type="button" className="btn-sm" onClick={() => setWindow(addBookingMonths(monthStart(productToday()), 1), 1)}>
          следующий месяц
        </button>
        <button type="button" className="btn-sm" onClick={() => setWindow(monthStart(productToday()), 3)}>
          3 месяца
        </button>
        <button type="button" className="btn-sm" onClick={() => setWindow(monthStart(productToday()), 6)}>
          6 месяцев
        </button>
      </div>

      {!hasValidWindow && <p className="alert alert-error">Период должен быть не короче одного дня.</p>}
      {analytics.isLoading && <p className="hint">Загрузка…</p>}
      {analytics.error && (
        <p className="alert alert-error" role="alert">
          {(analytics.error as Error).message}
        </p>
      )}
      {analytics.data && (
        <>
          <div className="kpi-grid" style={{ marginTop: "1rem" }}>
            {statCards(analytics.data).map((card) => (
              <div key={card.label} className="kpi">
                <div className="kpi-label">{card.label}</div>
                <div className="kpi-value">{card.value}</div>
              </div>
            ))}
          </div>

          <InventoryTable data={analytics.data} />
        </>
      )}
    </section>
  );
}

function InventoryTable({ data }: { data: InventoryAnalyticsResponse }) {
  return (
    <div className="card" style={{ marginTop: "1.25rem" }}>
      <table className="table-flush table-hover">
        <thead>
          <tr>
            <th>Конструкция / сторона</th>
            <th style={{ width: 140 }}>Статус</th>
            <th style={{ width: 120 }}>Загрузка</th>
            <th style={{ width: 150 }}>Выручка</th>
            <th style={{ width: 160 }}>Без цены</th>
            <th>Занятые интервалы</th>
          </tr>
        </thead>
        <tbody>
          {data.constructions.map((construction) => (
            <Fragment key={construction.constructionId}>
              <tr>
                <td colSpan={6} style={{ background: "var(--surface-muted)" }}>
                  <strong>{construction.code ?? construction.name}</strong>
                  <span className="subtle"> · {construction.address ?? construction.name}</span>
                </td>
              </tr>
              {construction.sides.map((side) => (
                <tr key={side.sideId}>
                  <td>
                    Сторона {side.sideCode}
                    {side.sideDescription ? <span className="subtle"> · {side.sideDescription}</span> : null}
                    <div className="subtle">
                      {side.effectivePricePerMonth == null ? "цена по запросу" : `${rub(side.effectivePricePerMonth)}/мес`}
                      {side.trafficPerDay != null ? ` · ${side.trafficPerDay.toLocaleString("ru-RU")} чел./день` : ""}
                      {side.grp != null ? ` · GRP ${side.grp}` : ""}
                    </div>
                  </td>
                  <td>{STATUS_LABEL[side.status]}</td>
                  <td>{percent(side.occupancyRate)}</td>
                  <td>{rub(side.plannedRevenue)}</td>
                  <td>{side.bookingsWithoutPrice}</td>
                  <td>{compactIntervals(side.busyIntervals)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {data.constructions.length === 0 && (
            <tr>
              <td colSpan={6} className="empty" style={{ textAlign: "center" }}>
                Нет сторон для выбранного периода.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
