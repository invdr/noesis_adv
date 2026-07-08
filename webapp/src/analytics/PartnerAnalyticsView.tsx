import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PartnerAnalyticsResponse, SessionUser } from "@noesis/contracts";
import { api } from "../api/client";
import { formatDateTime } from "../leads/shared";

type Preset = "7d" | "30d" | "month" | "custom";
type KindFilter = "all" | "realtor" | "agency";

const DAY_MS = 86400000;

/** Полночь даты (YYYY-MM-DD) по МСК — бэк считает период по МСК. */
function mskMidnight(value: string): Date {
  return new Date(`${value}T00:00:00+03:00`);
}

function rangeForPreset(preset: Preset, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  if (preset === "7d") return { from: new Date(now.getTime() - 7 * DAY_MS).toISOString() };
  if (preset === "30d") return { from: new Date(now.getTime() - 30 * DAY_MS).toISOString() };
  if (preset === "month") {
    // Первое число текущего месяца по МСК (как и произвольный период — бэк
    // считает по МСК; локальную таймзону браузера в расчёт не берём).
    const msk = new Date(now.getTime() + (now.getTimezoneOffset() + 180) * 60000);
    const first = `${msk.getFullYear()}-${String(msk.getMonth() + 1).padStart(2, "0")}-01`;
    return { from: mskMidnight(first).toISOString() };
  }
  return {
    from: from ? mskMidnight(from).toISOString() : undefined,
    to: to ? new Date(mskMidnight(to).getTime() + DAY_MS).toISOString() : undefined,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/**
 * Аналитика работы с риелторами/агентствами. Приведённые лиды и сделки —
 * когорта по дате поступления заявки за период; «последнее взаимодействие» —
 * по всем приведённым заявкам (или ручное). Менеджер видит цифры по своим
 * заявкам, admin — по всем.
 */
export function PartnerAnalyticsView({ user }: { user: SessionUser }) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");

  const range = useMemo(
    () => rangeForPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const analytics = useQuery({
    queryKey: ["partner-analytics", range.from ?? "", range.to ?? "", kind, search],
    queryFn: () =>
      api.partnerAnalytics({
        ...range,
        kind: kind === "all" ? undefined : kind,
        search: search || undefined,
      }),
    retry: false,
  });

  return (
    <section>
      <div className="toolbar">
        <PresetButton active={preset === "7d"} onClick={() => setPreset("7d")}>
          7 дней
        </PresetButton>
        <PresetButton active={preset === "30d"} onClick={() => setPreset("30d")}>
          30 дней
        </PresetButton>
        <PresetButton active={preset === "month"} onClick={() => setPreset("month")}>
          Текущий месяц
        </PresetButton>
        <PresetButton active={preset === "custom"} onClick={() => setPreset("custom")}>
          Произвольный
        </PresetButton>
        {preset === "custom" && (
          <span className="row" style={{ gap: 6 }}>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="subtle">—</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </span>
        )}
      </div>

      <div className="toolbar" style={{ marginTop: 8 }}>
        <PresetButton active={kind === "all"} onClick={() => setKind("all")}>
          Все
        </PresetButton>
        <PresetButton active={kind === "realtor"} onClick={() => setKind("realtor")}>
          Риелторы
        </PresetButton>
        <PresetButton active={kind === "agency"} onClick={() => setKind("agency")}>
          Агентства
        </PresetButton>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchDraft.trim());
        }}
        className="toolbar"
        style={{ marginTop: 8 }}
      >
        <input
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Поиск по ФИО"
          style={{ minWidth: 260 }}
        />
        <button type="submit" className="btn-sm">
          Найти
        </button>
        {search && (
          <button
            type="button"
            className="btn-sm"
            onClick={() => {
              setSearchDraft("");
              setSearch("");
            }}
          >
            Сбросить
          </button>
        )}
      </form>

      <p className="hint">
        Приведённые лиды и сделки — за выбранный период
        {user.role === "admin" ? "." : " (по вашим заявкам)."} «Последнее
        взаимодействие» и свод по агентству учитывают всю историю. Партнёров заводите в разделе «Контакты».
      </p>

      {analytics.isLoading && <p className="hint">Загрузка…</p>}
      {analytics.error && (
        <p className="alert alert-error" role="alert">
          {(analytics.error as Error).message}
        </p>
      )}
      {analytics.data && <PartnerTable data={analytics.data} />}
    </section>
  );
}

function PartnerTable({ data }: { data: PartnerAnalyticsResponse }) {
  return (
    <div className="card">
      <table className="table-flush table-hover">
        <thead>
          <tr>
            <th style={{ width: 44 }}>№</th>
            <th>ФИО</th>
            <th>Тип</th>
            <th>Агентство</th>
            <th style={{ width: 170 }}>Последнее взаимодействие</th>
            <th style={{ width: 130 }}>Приведено лидов</th>
            <th style={{ width: 100 }}>Сделки</th>
            <th style={{ width: 110 }}>Конверсия</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={r.contactId}>
              <td className="tnum muted">{i + 1}</td>
              <td>{r.fullName}</td>
              <td>{r.kind === "agency" ? "Агентство" : "Риелтор"}</td>
              <td>{r.agencyName ?? <span className="subtle">—</span>}</td>
              <td className="muted tnum">{formatDateTime(r.lastInteractionAt)}</td>
              <td className="tnum">{r.referredLeads}</td>
              <td className="tnum">{r.deals}</td>
              <td className="tnum">{r.referredLeads ? pct(r.conversion) : "—"}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={8} className="empty" style={{ textAlign: "center" }}>
                Партнёров нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PresetButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`btn-sm${active ? " btn-primary" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
