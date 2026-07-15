import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FinanceDistribution, UpsertFinancePayoutInput } from "@noesis/contracts";
import { api } from "../api/client";
import { productToday } from "../shared/date";
import { backMonths, currentMonth, monthLabel, percentLabel, parseAmount, rub } from "./finance-ui";

export function FinanceDistributionsTab() {
  const qc = useQueryClient();
  const [to, setTo] = useState(currentMonth());
  const [from, setFrom] = useState(backMonths(currentMonth(), 11));
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  const distributions = useQuery({
    queryKey: ["finance-distributions", from, to],
    queryFn: () => api.listFinanceDistributions({ from, to }),
  });
  // Тот же ключ, что у PayoutsSection — react-query делит кэш. Нужен, чтобы при
  // переоткрытии предупредить о выплатах, уже сделанных за месяц.
  const payouts = useQuery({
    queryKey: ["finance-payouts"],
    queryFn: () => api.listFinancePayouts({ pageSize: 100 }),
  });
  // Выплаты, отнесённые к месяцу: по учётному `month`, а без него — по месяцу даты.
  const payoutsForMonth = (month: string) =>
    payouts.data?.items.filter((p) => (p.month ?? p.date.slice(0, 7)) === month).length ?? 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["finance-distributions"] });
    qc.invalidateQueries({ queryKey: ["finance-summary"] });
  };
  const onErr = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const close = useMutation({
    mutationFn: (month: string) => api.closeFinanceDistribution(month),
    onSuccess: () => { setError(""); refresh(); },
    onError: onErr,
  });
  const reopen = useMutation({
    mutationFn: (month: string) => api.reopenFinanceDistribution(month),
    onSuccess: () => { setError(""); refresh(); },
    onError: onErr,
  });

  const selectedDist = distributions.data?.find((d) => d.month === selected) ?? null;

  return (
    <section>
      <div className="toolbar">
        <span className="subtle">Период:</span>
        <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="month" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="card" style={{ marginTop: "1rem" }}>
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th>Месяц</th>
              <th style={{ width: 140 }}>Поступления</th>
              <th style={{ width: 140 }}>Расходы</th>
              <th style={{ width: 150 }}>Чистый доход</th>
              <th style={{ width: 120 }}>Доли</th>
              <th style={{ width: 120 }}>Статус</th>
              <th style={{ width: 210 }}></th>
            </tr>
          </thead>
          <tbody>
            {distributions.data?.map((d) => (
              <tr
                key={d.month}
                onClick={() => setSelected(d.month === selected ? null : d.month)}
                style={{ cursor: "pointer", ...(d.month === selected ? { background: "var(--surface-muted)" } : {}) }}
              >
                <td><strong>{monthLabel(d.month)}</strong></td>
                <td>{rub(d.totalIncome)}</td>
                <td>{rub(d.totalExpense)}</td>
                <td style={{ color: d.netIncome < 0 ? "var(--primary)" : undefined }}>{rub(d.netIncome)}</td>
                <td className={d.shareBpsTotal === 10000 ? "" : "subtle"}>{percentLabel(d.shareBpsTotal)}</td>
                <td>
                  <span className={`badge ${d.status === "closed" ? "badge-success" : "badge-warn"}`}>
                    {d.status === "closed" ? "Закрыт" : "Открыт"}
                  </span>
                </td>
                <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                  {d.status === "closed" ? (
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={reopen.isPending}
                      onClick={() => {
                        const n = payoutsForMonth(d.month);
                        const warn = n > 0
                          ? ` Внимание: за месяц уже есть выплаты (${n}) — они останутся, а основание пересчитается. Проверьте их вручную.`
                          : "";
                        if (confirm(`Переоткрыть ${monthLabel(d.month)}? Снимок долей будет снят.${warn}`)) reopen.mutate(d.month);
                      }}
                    >
                      Переоткрыть
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-sm btn-primary"
                      disabled={close.isPending}
                      onClick={() => close.mutate(d.month)}
                    >
                      Закрыть месяц
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedDist && <AllocationsPanel dist={selectedDist} />}

      <PayoutsSection />
    </section>
  );
}

function AllocationsPanel({ dist }: { dist: FinanceDistribution }) {
  return (
    <div className="card" style={{ marginTop: "1.25rem" }}>
      <div className="card-body">
        <h3 style={{ marginTop: 0 }}>
          Распределение · {monthLabel(dist.month)}
          {dist.status === "open" ? <span className="subtle"> (превью, месяц не закрыт)</span> : null}
        </h3>
        {dist.shareBpsTotal !== 10000 && (
          <p className="alert alert-error">
            Сумма долей активных участников — {percentLabel(dist.shareBpsTotal)}. Для закрытия должно быть 100%.
          </p>
        )}
        <table className="table-flush">
          <thead>
            <tr>
              <th>Участник</th>
              <th style={{ width: 120 }}>Доля</th>
              <th style={{ width: 160 }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {dist.allocations.map((a) => (
              <tr key={a.participantId}>
                <td>{a.participantName}</td>
                <td>{percentLabel(a.shareBps)}</td>
                <td>{rub(a.amount)}</td>
              </tr>
            ))}
            {dist.allocations.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">Нет активных долей на этот месяц.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PayoutDraft {
  participantId: string;
  month: string;
  date: string;
  amount: string;
  comment: string;
}

function PayoutsSection() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PayoutDraft | null>(null);
  const [error, setError] = useState("");

  const payouts = useQuery({
    queryKey: ["finance-payouts"],
    queryFn: () => api.listFinancePayouts({ pageSize: 100 }),
  });
  const participants = useQuery({
    queryKey: ["finance-participants", false],
    queryFn: () => api.listFinanceParticipants(false),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["finance-payouts"] });
    qc.invalidateQueries({ queryKey: ["finance-summary"] });
  };
  const onErr = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const save = useMutation({
    mutationFn: (body: UpsertFinancePayoutInput) => api.createFinancePayout(body),
    onSuccess: () => { setDraft(null); setError(""); refresh(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFinancePayout(id),
    onSuccess: refresh,
    onError: onErr,
  });

  const submit = () => {
    if (!draft) return;
    const amount = parseAmount(draft.amount);
    if (!draft.participantId) { setError("Выберите участника"); return; }
    if (amount == null || amount <= 0) { setError("Укажите сумму больше 0"); return; }
    save.mutate({
      participantId: draft.participantId,
      month: draft.month || null,
      date: draft.date,
      amount,
      comment: draft.comment.trim() || null,
    });
  };

  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <div className="card-body">
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Выплаты участникам</h3>
          <button
            type="button"
            className="btn-sm btn-primary"
            onClick={() =>
              setDraft({ participantId: "", month: currentMonth(), date: productToday(), amount: "", comment: "" })
            }
          >
            + Выплата
          </button>
        </div>

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        {draft && (
          <div className="form-grid" style={{ marginTop: "0.75rem" }}>
            <label>
              <span>Участник</span>
              <select value={draft.participantId} onChange={(e) => setDraft({ ...draft, participantId: e.target.value })}>
                <option value="">— выберите —</option>
                {participants.data?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Учётный месяц</span>
              <input type="month" value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} />
            </label>
            <label>
              <span>Дата выплаты</span>
              <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <label>
              <span>Сумма, ₽</span>
              <input
                inputMode="numeric"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="0"
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              <span>Комментарий</span>
              <input value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} placeholder="Необязательно" />
            </label>
            <div className="toolbar" style={{ gridColumn: "1 / -1" }}>
              <button type="button" className="btn-primary" disabled={save.isPending} onClick={submit}>
                {save.isPending ? "Сохранение…" : "Сохранить"}
              </button>
              <button type="button" className="btn-sm" onClick={() => setDraft(null)}>Отмена</button>
            </div>
          </div>
        )}

        <table className="table-flush table-hover" style={{ marginTop: "0.75rem" }}>
          <thead>
            <tr>
              <th style={{ width: 120 }}>Дата</th>
              <th>Участник</th>
              <th style={{ width: 130 }}>Месяц</th>
              <th style={{ width: 150 }}>Сумма</th>
              <th>Комментарий</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {payouts.data?.items.map((p) => (
              <tr key={p.id}>
                <td>{p.date}</td>
                <td>{p.participantName}</td>
                <td>{p.month ? monthLabel(p.month) : "—"}</td>
                <td>{rub(p.amount)}</td>
                <td className="subtle">{p.comment ?? ""}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="btn-sm btn-danger"
                    onClick={() => { if (confirm("Удалить выплату?")) remove.mutate(p.id); }}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {payouts.data?.items.length === 0 && (
              <tr><td colSpan={6} className="empty" style={{ textAlign: "center" }}>Выплат пока нет.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
