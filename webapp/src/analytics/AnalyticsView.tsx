import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  STAGE_COLOR_HEX,
  type AnalyticsResponse,
  type LeadSourceOption,
  type SessionUser,
  type WeeklyPoint,
} from "@noesis/contracts";
import { api } from "../api/client";
import { sourceLabel } from "../leads/shared";
import { analyticsToCsv, downloadCsv } from "./analytics-csv";
import { PartnerAnalyticsView } from "./PartnerAnalyticsView";

type AnalyticsTab = "leads" | "partners";

/**
 * Раздел «Аналитика» с вкладками. Лидовая аналитика (`LeadAnalyticsView`) —
 * только admin; аналитика риелторов (`PartnerAnalyticsView`) — всем ролям.
 * Менеджер видит лишь вкладку «Риелторы» и открывается сразу на ней.
 */
export function AnalyticsView({ user }: { user: SessionUser }) {
  const isAdmin = user.role === "admin";
  const [tab, setTab] = useState<AnalyticsTab>(isAdmin ? "leads" : "partners");

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      {isAdmin && (
        <div className="segmented" role="tablist" aria-label="Раздел аналитики">
          <button
            role="tab"
            aria-selected={tab === "leads"}
            className={tab === "leads" ? "is-active" : ""}
            onClick={() => setTab("leads")}
          >
            Заявки
          </button>
          <button
            role="tab"
            aria-selected={tab === "partners"}
            className={tab === "partners" ? "is-active" : ""}
            onClick={() => setTab("partners")}
          >
            Риелторы
          </button>
        </div>
      )}

      {isAdmin && tab === "leads" ? (
        <LeadAnalyticsView />
      ) : (
        <PartnerAnalyticsView user={user} />
      )}
    </div>
  );
}

type Preset = "7d" | "30d" | "month" | "custom";

/** Полночь указанной даты (YYYY-MM-DD) по МСК — бэк бакетит период по МСК. */
function mskMidnight(value: string): Date {
  return new Date(`${value}T00:00:00+03:00`);
}

/** Один день в миллисекундах. */
const DAY_MS = 86400000;

function rangeForPreset(preset: Preset, from: string, to: string): {
  from?: string;
  to?: string;
} {
  const now = new Date();
  if (preset === "7d") {
    return { from: new Date(now.getTime() - 7 * 86400000).toISOString() };
  }
  if (preset === "30d") {
    return { from: new Date(now.getTime() - 30 * 86400000).toISOString() };
  }
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start.toISOString() };
  }
  // custom — границы по МСК; верхняя ИСКЛЮЧИТЕЛЬНА: берём начало следующего за
  // выбранным дня, чтобы конечный день целиком попал в период (`createdAt < to`).
  return {
    from: from ? mskMidnight(from).toISOString() : undefined,
    to: to ? new Date(mskMidnight(to).getTime() + DAY_MS).toISOString() : undefined,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Дашборд аналитики заявок (admin). Период когортный по дате поступления. */
function LeadAnalyticsView() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Источник фильтрует только динамику по неделям (`weekly`) — на бэке.
  const [weeklySource, setWeeklySource] = useState("");

  const range = useMemo(
    () => rangeForPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const analytics = useQuery({
    queryKey: ["analytics", range.from ?? "", range.to ?? "", weeklySource],
    queryFn: () => api.getAnalytics({ ...range, source: weeklySource || undefined }),
    retry: false,
  });
  // Справочник источников — для фильтра динамики по неделям.
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api.listSources(),
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
        <button
          className="ml-auto"
          disabled={!analytics.data}
          onClick={() => {
            if (!analytics.data) return;
            const stamp = analytics.data.to.slice(0, 10);
            downloadCsv(`analytics-${stamp}.csv`, analyticsToCsv(analytics.data));
          }}
        >
          Экспорт CSV
        </button>
      </div>

      {analytics.isLoading && <p className="hint">Загрузка…</p>}
      {analytics.error && (
        <p className="alert alert-error" role="alert">
          {(analytics.error as Error).message}
        </p>
      )}
      {analytics.data && (
        <Dashboard
          data={analytics.data}
          source={weeklySource}
          onSource={setWeeklySource}
          sources={sources.data ?? []}
        />
      )}
    </section>
  );
}

function Dashboard({
  data,
  source,
  onSource,
  sources,
}: {
  data: AnalyticsResponse;
  source: string;
  onSource: (v: string) => void;
  sources: LeadSourceOption[];
}) {
  const { conversion } = data;
  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="kpi-grid">
        <Metric label="Всего заявок" value={String(data.total)} />
        <Metric
          label="Конверсия в сделку"
          value={pct(conversion.wonRate)}
          hint={`сделок ${conversion.won} из ${data.total}`}
        />
        <Metric
          label="Доля закрытий в плюс"
          value={pct(conversion.closeRate)}
          hint={`won ${conversion.won} / закрыто ${conversion.won + conversion.lost}`}
          muted
        />
        <Metric label="В работе" value={String(conversion.inProgress)} muted />
      </div>

      <Panel title={`Динамика по дням (${data.daily.length}) · пик ${Math.max(1, ...data.daily.map((p) => p.count))}/день`}>
        <DailyChart points={data.daily} />
      </Panel>

      <div className="grid-2">
        <Panel title="По этапам">
          <BarList
            items={data.byStage.map((s) => ({
              label: s.name,
              value: s.count,
              color: STAGE_COLOR_HEX[s.color],
            }))}
          />
        </Panel>
        <Panel title="По источникам">
          <BarList
            items={data.bySource.map((s) => ({
              label: s.name ?? sourceLabel(s.source),
              value: s.count,
            }))}
          />
        </Panel>
        <Panel title="По конструкциям">
          {data.byProject.length === 0 ? (
            <Empty />
          ) : (
            <BarList items={data.byProject.map((p) => ({ label: p.name, value: p.count }))} />
          )}
        </Panel>
        <Panel title="По менеджерам">
          <BarList
            items={data.byManager.map((m) => ({
              label: m.name || m.email || "Не распределено",
              value: m.leads,
              sublabel: `сделок ${m.won} · контактов ${m.contacts}`,
              color: m.assigneeId === null ? "#94a3b8" : "#A4161A",
            }))}
          />
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Воронка (водопад)">
          {data.funnel.length === 0 ? (
            <Empty />
          ) : (
            <BarList
              items={data.funnel.map((f) => ({ label: f.name, value: f.reached }))}
            />
          )}
        </Panel>
        <Panel title="Время в этапе (ср., часы)">
          {data.stageDuration.length === 0 ? (
            <Empty />
          ) : (
            <BarList
              items={data.stageDuration.map((s) => ({
                label: s.name,
                value: s.avgHours,
                sublabel: `медиана ${s.medianHours} ч`,
              }))}
            />
          )}
        </Panel>
      </div>

      <section className="card">
        <div className="card-body">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h3 className="section-title" style={{ margin: 0 }}>
              Динамика по неделям
            </h3>
            <label className="row" style={{ gap: 6 }}>
              <span className="hint">Источник</span>
              <select value={source} onChange={(e) => onSource(e.target.value)}>
                <option value="">Все</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <WeeklyChart points={data.weekly} />
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${muted ? " is-muted" : ""}`}>{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-body">
        <h3 className="section-title">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function Empty() {
  return <p className="empty">Нет данных за период.</p>;
}

interface BarItem {
  label: string;
  value: number;
  sublabel?: string;
  color?: string;
}

/** Горизонтальные бар-чарты на CSS — без графических зависимостей. */
function BarList({ items }: { items: BarItem[] }) {
  if (items.length === 0) return <Empty />;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} className="bar-row">
          <span className="bar-label">
            {it.label}
            {it.sublabel && <span className="subtle"> · {it.sublabel}</span>}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                width: `${(it.value / max) * 100}%`,
                background: it.color ?? "var(--primary)",
              }}
            />
          </span>
          <span className="bar-value">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Динамика по дням — лёгкий SVG-график (линия + площадь). */
function DailyChart({ points }: { points: { date: string; count: number }[] }) {
  if (points.length === 0) return <Empty />;
  const w = 720;
  const h = 120;
  const pad = 4;
  const max = Math.max(1, ...points.map((p) => p.count));
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = points.map((p, i) => `${x(i)},${y(p.count)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${x(points.length - 1)},${h - pad}`;

  return (
    <>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: w, display: "block" }}>
        <polygon points={area} fill="#F0C9C9" />
        <polyline points={line} fill="none" stroke="#A4161A" strokeWidth={2} />
      </svg>
      <div className="row" style={{ justifyContent: "space-between", fontSize: 11, color: "var(--fg-subtle)" }}>
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </>
  );
}

/** Динамика по неделям — сгруппированные бары (создано/сделки/отказы) на SVG. */
function WeeklyChart({ points }: { points: WeeklyPoint[] }) {
  if (points.length === 0) return <Empty />;
  const w = 720;
  const h = 160;
  const pad = 8;
  const labelH = 16;
  const chartH = h - labelH;
  const series = [
    { key: "created", color: "#A4161A", label: "Создано" },
    { key: "won", color: "#16a34a", label: "Сделки" },
    { key: "lost", color: "#dc2626", label: "Отказы" },
  ] as const;
  const max = Math.max(1, ...points.flatMap((p) => [p.created, p.won, p.lost]));
  const groupW = (w - pad * 2) / points.length;
  const barW = Math.max(2, Math.min(14, (groupW - 4) / 3));
  const barH = (v: number) => (v / max) * (chartH - pad * 2);
  const y = (v: number) => pad + (chartH - pad * 2) - barH(v);
  const showLabels = points.length <= 14;

  return (
    <div className="stack" style={{ gap: 8, marginTop: 10 }}>
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        {series.map((s) => (
          <span key={s.key} className="row" style={{ gap: 6, alignItems: "center" }}>
            <span
              style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: "inline-block" }}
            />
            <span className="hint">{s.label}</span>
          </span>
        ))}
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        style={{ maxWidth: w, display: "block" }}
        role="img"
        aria-label="Динамика заявок по неделям"
      >
        {points.map((p, i) => {
          const base = pad + i * groupW + (groupW - barW * series.length) / 2;
          return (
            <g key={p.weekStart}>
              {series.map((s, j) => (
                <rect
                  key={s.key}
                  x={base + j * barW}
                  y={y(p[s.key])}
                  width={Math.max(1, barW - 1)}
                  height={barH(p[s.key])}
                  fill={s.color}
                >
                  <title>{`${p.weekStart}: ${s.label} ${p[s.key]}`}</title>
                </rect>
              ))}
              {showLabels && (
                <text
                  x={pad + i * groupW + groupW / 2}
                  y={h - 4}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--fg-subtle)"
                >
                  {p.weekStart.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
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
