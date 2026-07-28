import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FINANCE_EXPENSE_STATUS_LABEL,
  type FinanceExpense,
  type FinanceExpenseStatus,
  type UpsertFinanceExpenseInput,
} from "@noesis/contracts";
import { api } from "../api/client";
import { displayInclusivePeriod, productToday } from "../shared/date";
import { parseAmount, rub } from "./finance-ui";
import { TruncatedNotice } from "./TruncatedNotice";

interface Draft {
  id: string | null;
  date: string;
  amount: string;
  categoryId: string;
  status: FinanceExpenseStatus;
  constructionId: string;
  constructionSideId: string;
  bookingId: string;
  comment: string;
}

function emptyDraft(): Draft {
  return {
    id: null,
    date: productToday(),
    amount: "",
    categoryId: "",
    status: "draft",
    constructionId: "",
    constructionSideId: "",
    bookingId: "",
    comment: "",
  };
}

function toDraft(r: FinanceExpense): Draft {
  return {
    id: r.id,
    date: r.date,
    amount: String(r.amount),
    categoryId: r.category.id,
    status: r.status,
    constructionId: r.construction?.id ?? "",
    constructionSideId: r.constructionSideId ?? "",
    bookingId: r.booking?.id ?? "",
    comment: r.comment ?? "",
  };
}

export function FinanceExpensesTab() {
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | FinanceExpenseStatus>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");

  const expenses = useQuery({
    queryKey: ["finance-expenses", from, to, statusFilter],
    queryFn: () =>
      api.listFinanceExpenses({
        from: from || undefined,
        to: to || undefined,
        status: statusFilter || undefined,
        pageSize: 100,
      }),
  });
  const categories = useQuery({
    queryKey: ["finance-categories"],
    queryFn: () => api.listFinanceCategories(false),
  });
  const constructions = useQuery({
    queryKey: ["finance-constructions"],
    queryFn: () => api.listAllProjects({ includeArchived: true }),
  });
  const bookings = useQuery({
    queryKey: ["finance-expense-bookings", draft?.constructionId],
    queryFn: () => api.listAllBookings({ constructionId: draft?.constructionId }),
    enabled: Boolean(draft?.constructionId),
  });

  const selectedConstruction = constructions.data?.items.find((c) => c.id === draft?.constructionId);

  const refresh = () => qc.invalidateQueries({ queryKey: ["finance-expenses"] });
  const onErr = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const save = useMutation({
    mutationFn: (input: { id: string | null; body: UpsertFinanceExpenseInput }) =>
      input.id ? api.updateFinanceExpense(input.id, input.body) : api.createFinanceExpense(input.body),
    onSuccess: () => {
      setDraft(null);
      setError("");
      refresh();
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFinanceExpense(id),
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
    if (!draft.categoryId) {
      setError("Выберите статью");
      return;
    }
    save.mutate({
      id: draft.id,
      body: {
        date: draft.date,
        amount,
        categoryId: draft.categoryId,
        status: draft.status,
        constructionId: draft.constructionId || null,
        constructionSideId: draft.constructionSideId || null,
        bookingId: draft.bookingId || null,
        comment: draft.comment.trim() || null,
      },
    });
  };

  return (
    <section>
      <div className="toolbar">
        <button type="button" className="btn-primary btn-sm" onClick={() => setDraft(emptyDraft())}>
          + Расход
        </button>
        <span className="subtle">Период:</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | FinanceExpenseStatus)}>
          <option value="">все статусы</option>
          <option value="draft">черновики</option>
          <option value="confirmed">подтверждённые</option>
        </select>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <TruncatedNotice shown={expenses.data?.items.length} total={expenses.data?.total} />
      <div className="card" style={{ marginTop: "1rem" }}>
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Дата</th>
              <th style={{ width: 140 }}>Сумма</th>
              <th>Статья</th>
              <th style={{ width: 130 }}>Статус</th>
              <th>Конструкция</th>
              <th>Комментарий</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {expenses.data?.items.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{rub(r.amount)}</td>
                <td>{r.category.name}</td>
                <td>
                  <span className={`badge ${r.status === "confirmed" ? "badge-success" : "badge-neutral"}`}>
                    {FINANCE_EXPENSE_STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td>
                  {r.construction ? r.construction.code ?? r.construction.name : "—"}
                  {r.sideCode ? <span className="subtle"> · {r.sideCode}</span> : null}
                </td>
                <td className="subtle">{r.comment ?? ""}</td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn-sm" onClick={() => setDraft(toDraft(r))}>
                    Изменить
                  </button>{" "}
                  <button
                    type="button"
                    className="btn-sm btn-danger"
                    onClick={() => { if (confirm("Удалить расход?")) remove.mutate(r.id); }}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {expenses.data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="empty" style={{ textAlign: "center" }}>
                  Нет расходов за период.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="card" style={{ marginTop: "1.25rem" }}>
          <div className="card-body">
            <h3 style={{ marginTop: 0 }}>{draft.id ? "Изменить расход" : "Новый расход"}</h3>
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
                <span>Статья</span>
                <select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                  <option value="">— выберите —</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Статус</span>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as FinanceExpenseStatus })}
                >
                  <option value="draft">Черновик</option>
                  <option value="confirmed">Подтверждён</option>
                </select>
              </label>
              <label>
                <span>Конструкция</span>
                <select
                  value={draft.constructionId}
                  onChange={(e) => setDraft({ ...draft, constructionId: e.target.value, constructionSideId: "", bookingId: "" })}
                >
                  <option value="">— не указана —</option>
                  {constructions.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>{c.code ? `${c.code} · ${c.name}` : c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Сторона</span>
                <select
                  value={draft.constructionSideId}
                  disabled={!selectedConstruction}
                  onChange={(e) => setDraft({ ...draft, constructionSideId: e.target.value })}
                >
                  <option value="">— не указана —</option>
                  {selectedConstruction?.sides.map((s) => (
                    <option key={s.id} value={s.id}>Сторона {s.code}</option>
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
                    <option key={b.id} value={b.id}>{b.side.code} · {displayInclusivePeriod(b.startDate, b.endDate)}</option>
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
