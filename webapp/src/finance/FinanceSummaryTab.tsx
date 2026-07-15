import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FINANCE_PARTICIPANT_KIND_LABEL } from "@noesis/contracts";
import { api } from "../api/client";
import { backMonths, currentMonth, monthLabel, rub } from "./finance-ui";

export function FinanceSummaryTab() {
  const [to, setTo] = useState(currentMonth());
  const [from, setFrom] = useState(backMonths(currentMonth(), 5));

  const summary = useQuery({
    queryKey: ["finance-summary", from, to],
    queryFn: () => api.financeSummary({ from, to }),
    enabled: from <= to,
  });

  const s = summary.data;

  return (
    <section>
      <div className="toolbar">
        <span className="subtle">Период:</span>
        <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="month" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {from > to && <p className="alert alert-error">Начало периода позже конца.</p>}
      {summary.isLoading && <p className="hint">Загрузка…</p>}
      {summary.error && (
        <p className="alert alert-error" role="alert">{(summary.error as Error).message}</p>
      )}

      {s && (
        <>
          <div className="cards-grid" style={{ marginTop: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {[
              { label: "Поступления", value: rub(s.totalIncome) },
              { label: "Подтверждённые расходы", value: rub(s.totalExpenseConfirmed) },
              { label: "Чистый доход", value: rub(s.netIncome) },
              { label: "Разнесено (закрыто)", value: rub(s.distributedNet) },
            ].map((c) => (
              <div key={c.label} className="card" style={{ flex: "1 1 180px" }}>
                <div className="card-body">
                  <div className="subtle">{c.label}</div>
                  <strong style={{ fontSize: 24 }}>{c.value}</strong>
                </div>
              </div>
            ))}
          </div>

          {s.totalExpenseDraft > 0 && (
            <p className="subtle" style={{ marginTop: "0.75rem" }}>
              Расходы-черновики за период: {rub(s.totalExpenseDraft)} — не входят в чистый доход, пока не подтверждены.
            </p>
          )}
          {s.hasOpenMonths && (
            <p className="alert alert-warn" style={{ marginTop: "0.5rem" }}>
              В периоде есть незакрытые месяцы с активностью. Закройте их во вкладке «Распределения»,
              чтобы разнести чистый доход по участникам.
            </p>
          )}

          <h3 style={{ marginTop: "1.5rem" }}>Участники: начислено и выплачено</h3>
          <div className="card">
            <table className="table-flush table-hover">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th style={{ width: 130 }}>Роль</th>
                  <th style={{ width: 150 }}>Начислено</th>
                  <th style={{ width: 150 }}>Выплачено</th>
                  <th style={{ width: 160 }}>К выплате</th>
                </tr>
              </thead>
              <tbody>
                {s.participants.map((p) => (
                  <tr key={p.participantId}>
                    <td>{p.participantName}</td>
                    <td>{FINANCE_PARTICIPANT_KIND_LABEL[p.kind]}</td>
                    <td>{rub(p.allocated)}</td>
                    <td>{rub(p.paidOut)}</td>
                    <td>
                      <strong style={{ color: p.outstanding < 0 ? "var(--primary)" : undefined }}>
                        {rub(p.outstanding)}
                      </strong>
                    </td>
                  </tr>
                ))}
                {s.participants.length === 0 && (
                  <tr><td colSpan={5} className="empty" style={{ textAlign: "center" }}>Нет начислений и выплат за период.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: "1.5rem" }}>P&amp;L по конструкциям</h3>
          <div className="card">
            <table className="table-flush table-hover">
              <thead>
                <tr>
                  <th>Конструкция</th>
                  <th style={{ width: 150 }}>Поступления</th>
                  <th style={{ width: 150 }}>Расходы</th>
                  <th style={{ width: 150 }}>Итого</th>
                </tr>
              </thead>
              <tbody>
                {s.constructions.map((c, i) => (
                  <tr key={c.construction?.id ?? `none-${i}`}>
                    <td>{c.construction ? c.construction.code ?? c.construction.name : "— без привязки —"}</td>
                    <td>{rub(c.income)}</td>
                    <td>{rub(c.expense)}</td>
                    <td style={{ color: c.net < 0 ? "var(--primary)" : undefined }}>{rub(c.net)}</td>
                  </tr>
                ))}
                {s.constructions.length === 0 && (
                  <tr><td colSpan={4} className="empty" style={{ textAlign: "center" }}>Нет данных за период.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="subtle" style={{ marginTop: "1rem" }}>
            Период: {monthLabel(s.from)} — {monthLabel(s.to)}. Плановая цена броней в распределении не участвует —
            учитываются только фактические поступления.
          </p>
        </>
      )}
    </section>
  );
}
