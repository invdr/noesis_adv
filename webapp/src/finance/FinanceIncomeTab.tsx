import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FinanceIncome, UpsertFinanceIncomeInput } from "@noesis/contracts";
import { api } from "../api/client";
import { productToday } from "../shared/date";
import { parseAmount, rub } from "./finance-ui";

interface Draft {
  id: string | null;
  date: string;
  amount: string;
  constructionId: string;
  bookingId: string;
  comment: string;
}

function emptyDraft(): Draft {
  return { id: null, date: productToday(), amount: "", constructionId: "", bookingId: "", comment: "" };
}

function toDraft(r: FinanceIncome): Draft {
  return {
    id: r.id,
    date: r.date,
    amount: String(r.amount),
    constructionId: r.construction?.id ?? "",
    bookingId: r.booking?.id ?? "",
    comment: r.comment ?? "",
  };
}

export function FinanceIncomeTab() {
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");

  const income = useQuery({
    queryKey: ["finance-income", from, to],
    queryFn: () => api.listFinanceIncome({ from: from || undefined, to: to || undefined, pageSize: 100 }),
  });
  const constructions = useQuery({
    queryKey: ["finance-constructions"],
    queryFn: () => api.listAllProjects({ includeArchived: true }),
  });
  const bookings = useQuery({
    queryKey: ["finance-income-bookings", draft?.constructionId],
    queryFn: () => api.listAllBookings({ constructionId: draft?.constructionId }),
    enabled: Boolean(draft?.constructionId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["finance-income"] });
  const onErr = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const save = useMutation({
    mutationFn: (input: { id: string | null; body: UpsertFinanceIncomeInput }) =>
      input.id ? api.updateFinanceIncome(input.id, input.body) : api.createFinanceIncome(input.body),
    onSuccess: () => {
      setDraft(null);
      setError("");
      refresh();
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFinanceIncome(id),
    onSuccess: refresh,
    onError: onErr,
  });

  const submit = () => {
    if (!draft) return;
    const amount = parseAmount(draft.amount);
    if (amount == null || amount <= 0) {
      setError("Укажите сумму больше 0");
      return;
    }
    if (!draft.date) {
      setError("Укажите дату");
      return;
    }
    save.mutate({
      id: draft.id,
      body: {
        date: draft.date,
        amount,
        constructionId: draft.constructionId || null,
        bookingId: draft.bookingId || null,
        comment: draft.comment.trim() || null,
      },
    });
  };

  return (
    <section>
      <div className="toolbar">
        <button type="button" className="btn-primary btn-sm" onClick={() => setDraft(emptyDraft())}>
          + Поступление
        </button>
        <span className="subtle">Период:</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {(from || to) && (
          <button type="button" className="btn-sm" onClick={() => { setFrom(""); setTo(""); }}>
            сбросить
          </button>
        )}
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <div className="card" style={{ marginTop: "1rem" }}>
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Дата</th>
              <th style={{ width: 150 }}>Сумма</th>
              <th>Конструкция</th>
              <th>Бронь</th>
              <th>Комментарий</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {income.data?.items.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{rub(r.amount)}</td>
                <td>{r.construction ? r.construction.code ?? r.construction.name : "—"}</td>
                <td>{r.booking ? `${r.booking.sideCode ?? ""} ${r.booking.startDate}` : "—"}</td>
                <td className="subtle">{r.comment ?? ""}</td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn-sm" onClick={() => setDraft(toDraft(r))}>
                    Изменить
                  </button>{" "}
                  <button
                    type="button"
                    className="btn-sm btn-danger"
                    onClick={() => { if (confirm("Удалить поступление?")) remove.mutate(r.id); }}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {income.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="empty" style={{ textAlign: "center" }}>
                  Нет поступлений за период.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="card" style={{ marginTop: "1.25rem" }}>
          <div className="card-body">
            <h3 style={{ marginTop: 0 }}>{draft.id ? "Изменить поступление" : "Новое поступление"}</h3>
            <div className="form-grid">
              <label>
                <span>Дата</span>
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
              <label>
                <span>Конструкция</span>
                <select
                  value={draft.constructionId}
                  onChange={(e) => setDraft({ ...draft, constructionId: e.target.value, bookingId: "" })}
                >
                  <option value="">— не указана —</option>
                  {constructions.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code ? `${c.code} · ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Бронь</span>
                <select
                  value={draft.bookingId}
                  disabled={!draft.constructionId}
                  onChange={(e) => setDraft({ ...draft, bookingId: e.target.value })}
                >
                  <option value="">— не указана —</option>
                  {bookings.data?.items.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.side.code} · {b.startDate}–{b.endDate}
                      {b.client ? ` · ${b.client.fullName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Комментарий</span>
                <input
                  value={draft.comment}
                  onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                  placeholder="Необязательно"
                />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: "1rem" }}>
              <button type="button" className="btn-primary" disabled={save.isPending} onClick={submit}>
                {save.isPending ? "Сохранение…" : "Сохранить"}
              </button>
              <button type="button" className="btn-sm" onClick={() => setDraft(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
