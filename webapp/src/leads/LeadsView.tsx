import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Funnel, Lead, SessionUser, Stage } from "@noesis/contracts";
import { api, ApiError, type LeadListParams } from "../api/client";
import { LeadCard } from "./LeadCard";
import { KanbanBoard, type BoardFilters } from "./KanbanBoard";
import { ManualLeadForm } from "./ManualLeadForm";
import { formatDateTime, nextContactBadge, sourceLabel } from "./shared";

const PAGE_SIZE = 25;

export function LeadsView({
  stages,
  funnels,
  user,
  expired,
  selectedLeadId,
  onOpenLead,
  onCloseLead,
}: {
  stages: Stage[];
  funnels: Funnel[];
  user: SessionUser;
  expired: boolean;
  // Выбранная заявка задаётся маршрутом (`#/leads/<id>`), а не локально: карточка
  // открывается по прямой ссылке/F5, а список сохраняет фильтры и страницу, пока
  // `LeadsView` смонтирован.
  selectedLeadId?: string;
  onOpenLead: (id: string) => void;
  onCloseLead: () => void;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  // Выбранная воронка — первая по порядку (listFunnels отдаёт по order asc):
  // какая вкладка первая, на той раздел и открывается. `isDefault` влияет только
  // на приём публичных заявок, не на стартовую вкладку.
  const [funnelId, setFunnelId] = useState("");
  useEffect(() => {
    if (funnels.length === 0) return;
    if (!funnels.some((f) => f.id === funnelId)) {
      setFunnelId(funnels[0]!.id);
    }
  }, [funnels, funnelId]);
  // Этапы выбранной воронки — для доски, фильтра и KPI.
  const funnelStages = funnelId
    ? stages.filter((s) => s.funnelId === funnelId)
    : stages;
  // Режим (список/доска) запоминаем между визитами.
  const [mode, setMode] = useState<"list" | "board">(() => {
    try {
      return localStorage.getItem("leads-mode") === "board" ? "board" : "list";
    } catch {
      return "list";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("leads-mode", mode);
    } catch {
      /* приватный режим и т. п. — молча игнорируем */
    }
  }, [mode]);

  // Фильтры (селекты применяются сразу; поиск — по сабмиту формы).
  const [stageId, setStageId] = useState("");
  const [source, setSource] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  // Админ фильтрует адресно: "" — все, "none" — очередь, иначе id менеджера.
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const assigneeParam =
    user.role === "admin" ? assigneeFilter || undefined : onlyMine ? user.id : undefined;

  const params: LeadListParams = {
    page,
    funnelId: funnelId || undefined,
    stageId: stageId || undefined,
    source: source || undefined,
    constructionId: projectFilter || undefined,
    assigneeId: assigneeParam,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    search: search || undefined,
  };

  // Фильтры доски (этап тут задают сами колонки, поэтому без stageId).
  const boardFilters: BoardFilters = {
    funnelId: funnelId || undefined,
    source: source || undefined,
    constructionId: projectFilter || undefined,
    assigneeId: assigneeParam,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    search: search || undefined,
  };

  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api.stats(), retry: false });
  // Учётки для показа ответственного по почте (а не «Другой менеджер») — админу.
  const managers = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: user.role === "admin",
    retry: false,
  });
  const userById = useMemo(
    () => new Map((managers.data ?? []).map((u) => [u.id, u] as const)),
    [managers.data],
  );
  const projects = useQuery({
    queryKey: ["projects", "picker"],
    queryFn: () => api.listProjects({ pageSize: 100 }),
    retry: false,
  });
  // Справочник источников — для фильтра (живые).
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api.listSources(),
    retry: false,
  });
  const leads = useQuery({
    queryKey: ["leads", params],
    queryFn: () => api.listLeads(params),
    enabled: mode === "list",
    retry: false,
  });

  const move = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      api.updateLeadStage(id, { stageId: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? id;
  const resetPage = () => setPage(1);
  const changeFunnel = (id: string) => {
    setFunnelId(id);
    setStageId(""); // этап из другой воронки больше не применим
    resetPage();
  };

  if (selectedLeadId) {
    return (
      <LeadCard
        leadId={selectedLeadId}
        stages={stages}
        funnels={funnels}
        user={user}
        onBack={onCloseLead}
        onOpenRelated={onOpenLead}
      />
    );
  }

  const total = leads.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // KPI «Всего заявок» считаем по этапам выбранной воронки — чтобы плитка
  // сходилась с суммой плиток-этапов ниже (stats.total — глобальный по всем воронкам).
  const funnelTotal = funnelStages.reduce(
    (sum, s) => sum + (stats.data?.byStage[s.id] ?? 0),
    0,
  );

  return (
    <>
      <section className="kpi-grid" style={{ marginBottom: "1.25rem" }}>
        <Stat label="Всего заявок" value={funnelTotal} />
        {funnelStages.map((s) => (
          <Stat
            key={s.id}
            label={s.name}
            value={stats.data?.byStage[s.id] ?? 0}
            color={s.color}
          />
        ))}
      </section>

      <section className="toolbar">
        {funnels.length > 1 && (
          <div className="segmented" role="tablist" aria-label="Воронка">
            {funnels.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={funnelId === f.id}
                className={funnelId === f.id ? "is-active" : ""}
                onClick={() => changeFunnel(f.id)}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}

        <div className="segmented" role="tablist" aria-label="Режим заявок">
          <button
            role="tab"
            aria-selected={mode === "list"}
            className={mode === "list" ? "is-active" : ""}
            onClick={() => setMode("list")}
          >
            Список
          </button>
          <button
            role="tab"
            aria-selected={mode === "board"}
            className={mode === "board" ? "is-active" : ""}
            onClick={() => setMode("board")}
          >
            Доска
          </button>
        </div>

        {mode === "list" && (
          <label className="row" style={{ gap: 6 }}>
            <span className="hint">Этап</span>
            <select
              value={stageId}
              onChange={(e) => {
                setStageId(e.target.value);
                resetPage();
              }}
            >
              <option value="">Все</option>
              {funnelStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="row" style={{ gap: 6 }}>
          <span className="hint">Источник</span>
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              resetPage();
            }}
          >
            <option value="">Все</option>
            {(sources.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="row" style={{ gap: 6 }}>
          <span className="hint">С</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPage();
            }}
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="hint">По</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPage();
            }}
          />
        </label>

        <label className="row" style={{ gap: 6 }}>
          <span className="hint">Конструкция</span>
          <select
            value={projectFilter}
            onChange={(e) => {
              setProjectFilter(e.target.value);
              resetPage();
            }}
          >
            <option value="">Все</option>
            {(projects.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {user.role === "admin" ? (
          <label className="row" style={{ gap: 6 }}>
            <span className="hint">Ответственный</span>
            <select
              value={assigneeFilter}
              onChange={(e) => {
                setAssigneeFilter(e.target.value);
                resetPage();
              }}
            >
              <option value="">Все</option>
              <option value="none">Не назначен (очередь)</option>
              {(managers.data ?? [])
                .filter((u) => u.role === "manager")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => {
                setOnlyMine(e.target.checked);
                resetPage();
              }}
            />
            Только мои
          </label>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchDraft.trim());
            resetPage();
          }}
          className="row"
          style={{ gap: 6 }}
        >
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Поиск по имени или телефону"
          />
          <button type="submit" className="btn-primary">
            Найти
          </button>
        </form>

        <button
          className="btn-primary ml-auto"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? "Закрыть форму" : "Принять заявку"}
        </button>
        <button onClick={() => api.exportLeads(params)}>Экспорт CSV</button>
      </section>

      {adding && (
        <ManualLeadForm
          user={user}
          managers={managers.data ?? []}
          funnels={funnels}
          defaultFunnelId={funnelId || undefined}
          onClose={() => setAdding(false)}
          onCreated={() => setAdding(false)}
        />
      )}

      {mode === "board" && (
        <KanbanBoard
          stages={funnelStages}
          user={user}
          filters={boardFilters}
          onOpen={onOpenLead}
          assigneeName={(id) => {
            const u = userById.get(id);
            return u ? u.name || u.email : undefined;
          }}
        />
      )}

      {mode === "list" && leads.isLoading && <p className="hint">Загрузка…</p>}
      {mode === "list" && leads.error && !expired && (
        <p className="alert alert-error" role="alert">
          {(leads.error as ApiError).message}
        </p>
      )}

      {mode === "list" && leads.data && (
        <>
          <div className="card">
            <table className="table-flush table-hover">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>Дата</th>
                  <th>Имя</th>
                  <th>Телефон</th>
                  <th>Источник</th>
                  <th>Конструкция</th>
                  <th style={{ width: 170 }}>Этап</th>
                  <th style={{ width: 150 }}>След. контакт</th>
                  <th>Ответственный</th>
                </tr>
              </thead>
              <tbody>
                {leads.data.items.map((lead) => {
                  const liveStage = funnelStages.some((s) => s.id === lead.stageId);
                  return (
                    <tr key={lead.id}>
                      <td className="muted tnum">{formatDateTime(lead.createdAt)}</td>
                      <td>
                        <button className="link-btn" onClick={() => onOpenLead(lead.id)}>
                          {lead.name}
                        </button>
                        {lead.isRepeat && (
                          <span className="badge badge-warn" style={{ marginLeft: 6 }}>
                            повторная
                          </span>
                        )}
                      </td>
                      <td className="tnum">{lead.phone}</td>
                      <td>{lead.sourceName ?? sourceLabel(lead.source)}</td>
                      <td>{lead.constructionName ?? <span className="subtle">—</span>}</td>
                      <td>
                        <select
                          aria-label={`Этап заявки: ${lead.name}`}
                          value={liveStage ? lead.stageId : ""}
                          onChange={(e) => move.mutate({ id: lead.id, next: e.target.value })}
                        >
                          {!liveStage && (
                            <option value="">{stageName(lead.stageId)} (архив)</option>
                          )}
                          {funnelStages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="tnum">
                        <NextContactCell lead={lead} />
                      </td>
                      <td>
                        {lead.assigneeId ? (
                          lead.assigneeId === user.id ? (
                            <span className="badge badge-info">Вы</span>
                          ) : (
                            (() => {
                              const u = userById.get(lead.assigneeId);
                              return u ? (
                                <span className="muted" title={u.email}>
                                  {u.name || u.email}
                                </span>
                              ) : (
                                <span className="muted">Другой менеджер</span>
                              );
                            })()
                          )
                        ) : (
                          <span className="subtle">Не назначен</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {leads.data.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty" style={{ textAlign: "center" }}>
                      Заявок нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: "1rem", gap: 12 }}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Назад
            </button>
            <span className="hint">
              Страница {page} из {totalPages} · всего {total}
            </span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Вперёд →
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Дата следующего контакта в списке: просроченная — красным, сегодняшняя —
 * оранжевым (день по МСК, как в «Моём дне»); у закрытых даты нет — прочерк.
 */
function NextContactCell({ lead }: { lead: Lead }) {
  if (!lead.nextContactAt) {
    return lead.stage.kind === "in_progress" ? (
      <span className="subtle">не назначен</span>
    ) : (
      <span className="subtle">—</span>
    );
  }
  const badge = nextContactBadge(lead.nextContactAt);
  const style =
    badge.tone === "danger"
      ? { color: "var(--danger)", fontWeight: 600 }
      : badge.tone === "warn"
        ? { color: "var(--warn, #d97706)", fontWeight: 600 }
        : undefined;
  return <span style={style}>{formatDateTime(lead.nextContactAt)}</span>;
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className={`kpi${color ? ` kpi-stage stage-c-${color}` : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
