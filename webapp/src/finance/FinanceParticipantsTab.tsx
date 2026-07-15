import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FINANCE_PARTICIPANT_KIND_LABEL,
  shareActiveInMonth,
  type FinanceParticipant,
  type FinanceParticipantKind,
  type UpsertFinanceParticipantInput,
} from "@noesis/contracts";
import { api } from "../api/client";
import { currentMonth, percentLabel, bpsToPercent, percentToBps } from "./finance-ui";

const KINDS: FinanceParticipantKind[] = ["owner", "investor", "other"];

interface ShareDraft {
  shareBps: string; // проценты строкой
  startMonth: string;
  endMonth: string;
}

interface Draft {
  id: string | null;
  name: string;
  kind: FinanceParticipantKind;
  note: string;
  shares: ShareDraft[];
}

const EMPTY: Draft = {
  id: null,
  name: "",
  kind: "investor",
  note: "",
  shares: [{ shareBps: "", startMonth: currentMonth(), endMonth: "" }],
};

function toDraft(p: FinanceParticipant): Draft {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    note: p.note ?? "",
    shares: p.shares.length
      ? p.shares.map((s) => ({
          shareBps: bpsToPercent(s.shareBps),
          startMonth: s.startMonth,
          endMonth: s.endMonth ?? "",
        }))
      : [{ shareBps: "", startMonth: currentMonth(), endMonth: "" }],
  };
}

function currentShareLabel(p: FinanceParticipant): string {
  const cur = currentMonth();
  const share = p.shares.find((s) => shareActiveInMonth(s, cur));
  return share ? percentLabel(share.shareBps) : "—";
}

export function FinanceParticipantsTab() {
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");

  const participants = useQuery({
    queryKey: ["finance-participants", includeArchived],
    queryFn: () => api.listFinanceParticipants(includeArchived),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["finance-participants"] });
  const onErr = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const save = useMutation({
    mutationFn: (input: { id: string | null; body: UpsertFinanceParticipantInput }) =>
      input.id
        ? api.updateFinanceParticipant(input.id, input.body)
        : api.createFinanceParticipant(input.body),
    onSuccess: () => {
      setDraft(null);
      setError("");
      refresh();
    },
    onError: onErr,
  });

  const archive = useMutation({
    mutationFn: (p: FinanceParticipant) =>
      p.isArchived ? api.restoreFinanceParticipant(p.id) : api.archiveFinanceParticipant(p.id),
    onSuccess: refresh,
    onError: onErr,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFinanceParticipant(id),
    onSuccess: refresh,
    onError: onErr,
  });

  const submit = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Укажите имя участника");
      return;
    }
    const shares: UpsertFinanceParticipantInput["shares"] = [];
    for (const s of draft.shares) {
      const bps = percentToBps(s.shareBps);
      if (bps == null) {
        setError("Проверьте проценты долей (больше 0)");
        return;
      }
      if (!s.startMonth) {
        setError("У каждой доли укажите месяц начала");
        return;
      }
      shares.push({ shareBps: bps, startMonth: s.startMonth, endMonth: s.endMonth || null });
    }
    save.mutate({
      id: draft.id,
      body: { name: draft.name.trim(), kind: draft.kind, note: draft.note.trim() || null, shares },
    });
  };

  return (
    <section>
      <div className="toolbar">
        <button type="button" className="btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY })}>
          + Участник
        </button>
        <label className="subtle" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          показывать архивные
        </label>
      </div>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <div className="card" style={{ marginTop: "1rem" }}>
        <table className="table-flush table-hover">
          <thead>
            <tr>
              <th>Участник</th>
              <th style={{ width: 130 }}>Роль</th>
              <th style={{ width: 130 }}>Доля (тек. мес.)</th>
              <th style={{ width: 220 }}></th>
            </tr>
          </thead>
          <tbody>
            {participants.data?.map((p) => (
              <tr key={p.id} style={p.isArchived ? { opacity: 0.55 } : undefined}>
                <td>
                  <strong>{p.name}</strong>
                  {p.isArchived ? <span className="subtle"> · в архиве</span> : null}
                  {p.note ? <div className="subtle">{p.note}</div> : null}
                </td>
                <td>{FINANCE_PARTICIPANT_KIND_LABEL[p.kind]}</td>
                <td>{currentShareLabel(p)}</td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="btn-sm" onClick={() => setDraft(toDraft(p))}>
                    Изменить
                  </button>{" "}
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => archive.mutate(p)}
                  >
                    {p.isArchived ? "Вернуть" : "В архив"}
                  </button>{" "}
                  <button
                    type="button"
                    className="btn-sm btn-danger"
                    onClick={() => {
                      if (confirm(`Удалить участника «${p.name}» навсегда?`)) remove.mutate(p.id);
                    }}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {participants.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="empty" style={{ textAlign: "center" }}>
                  Пока нет участников.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="card" style={{ marginTop: "1.25rem" }}>
          <div className="card-body">
            <h3 style={{ marginTop: 0 }}>{draft.id ? "Изменить участника" : "Новый участник"}</h3>
            <div className="form-grid">
              <label>
                <span>Имя</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Имя участника"
                />
              </label>
              <label>
                <span>Роль</span>
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as FinanceParticipantKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {FINANCE_PARTICIPANT_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Заметка</span>
                <input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="Необязательно"
                />
              </label>
            </div>

            <div style={{ marginTop: "1rem" }}>
              <div className="subtle" style={{ marginBottom: 6 }}>
                Доли по периодам (месяц начала включительно, конец — исключительно; пусто = бессрочно)
              </div>
              {draft.shares.map((s, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}
                >
                  <input
                    style={{ width: 100 }}
                    inputMode="decimal"
                    value={s.shareBps}
                    onChange={(e) => {
                      const shares = [...draft.shares];
                      shares[i] = { ...s, shareBps: e.target.value };
                      setDraft({ ...draft, shares });
                    }}
                    placeholder="%"
                  />
                  <span className="subtle">%, c</span>
                  <input
                    type="month"
                    value={s.startMonth}
                    onChange={(e) => {
                      const shares = [...draft.shares];
                      shares[i] = { ...s, startMonth: e.target.value };
                      setDraft({ ...draft, shares });
                    }}
                  />
                  <span className="subtle">по</span>
                  <input
                    type="month"
                    value={s.endMonth}
                    onChange={(e) => {
                      const shares = [...draft.shares];
                      shares[i] = { ...s, endMonth: e.target.value };
                      setDraft({ ...draft, shares });
                    }}
                  />
                  <button
                    type="button"
                    className="btn-sm btn-danger"
                    onClick={() =>
                      setDraft({ ...draft, shares: draft.shares.filter((_, j) => j !== i) })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-sm"
                onClick={() =>
                  setDraft({
                    ...draft,
                    shares: [...draft.shares, { shareBps: "", startMonth: currentMonth(), endMonth: "" }],
                  })
                }
              >
                + период доли
              </button>
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
