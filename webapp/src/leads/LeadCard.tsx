import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STAGE_COLOR_HEX } from "@noesis/contracts";
import type { Funnel, SessionUser, Stage } from "@noesis/contracts";
import { api } from "../api/client";
import { copyToClipboard } from "../ui/clipboard";
import { navigate } from "../router";
import { listProjectOptions } from "../projects/project-options";
import { canEditLead, formatDateTime, nextContactBadge, sourceLabel } from "./shared";
import { DealSection } from "./DealSection";

/** Элемент единой ленты активности заявки (этап, заметка, назначение, задача). */
interface ActivityItem {
  id: string;
  at: string;
  kind: "stage" | "note" | "assign" | "contact";
  title: string;
  author: string;
}

interface ContactTimelineItem {
  id: string;
  kind: "pending" | "scheduled" | "cleared" | "done" | "cancelled" | "missed";
  at: string | null;
  createdAt: string;
  title: string;
  author: string;
}

/** Преобразование ISO → значение для <input type="datetime-local"> в локали. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function LeadCard({
  leadId,
  stages,
  funnels,
  user,
  onBack,
  onOpenRelated,
}: {
  leadId: string;
  stages: Stage[];
  /** Справочник воронок — для подписи воронки сделки в карточке. */
  funnels: Funnel[];
  user: SessionUser;
  onBack: () => void;
  onOpenRelated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  // Короткая обратная связь кнопки «копировать телефон».
  const [copied, setCopied] = useState(false);
  const lead = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => api.getLead(leadId),
    retry: false,
  });

  // Список менеджеров для адресного назначения — только админу. Общий с
  // UsersView ключ ["users"]: блокировка/создание там обновляет и эту выпадашку.
  const managers = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: user.role === "admin",
    retry: false,
  });
  const managerOptions = (managers.data ?? []).filter(
    (u) => u.role === "manager" && u.isActive,
  );
  // Карта id→учётка: админу показываем ответственного по почте, а не «Другой
  // менеджер» (managers.data грузится только админу).
  const userById = useMemo(
    () => new Map((managers.data ?? []).map((u) => [u.id, u] as const)),
    [managers.data],
  );

  // Типы следующего контакта (звонок/сообщение/встреча…) — справочник для всех.
  const contactTypes = useQuery({
    queryKey: ["contact-types"],
    queryFn: () => api.listContactTypes(),
    retry: false,
  });

  // Справочник источников — селект уточнения канала (живые + архивный текущий).
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api.listSources(),
    retry: false,
  });

  const projects = useQuery({
    queryKey: ["projects", "lead-picker", "all"],
    queryFn: () => listProjectOptions(),
    retry: false,
  });

  // Партнёры и компании для выбора реферера в карточке.
  const partners = useQuery({
    queryKey: ["contacts", "partner", ""],
    queryFn: () => api.listContacts({ role: "partner", type: "individual" }),
    retry: false,
  });
  const companies = useQuery({
    queryKey: ["contacts", "company", ""],
    queryFn: () => api.listContacts({ role: "partner", type: "company" }),
    retry: false,
  });

  const [noteText, setNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [nextContact, setNextContact] = useState<string | null>(null);
  const [nextType, setNextType] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  };

  const changeStage = useMutation({
    mutationFn: (stageId: string) => api.updateLeadStage(leadId, { stageId }),
    onSuccess: invalidate,
  });
  const assign = useMutation({
    mutationFn: (assigneeId: string | null) =>
      api.assignLead(leadId, { assigneeId }),
    onSuccess: invalidate,
  });
  const changeSource = useMutation({
    mutationFn: (source: string) => api.updateLeadSource(leadId, { source }),
    onSuccess: invalidate,
  });
  const changeProject = useMutation({
    mutationFn: (constructionId: string | null) => api.updateLeadProject(leadId, { constructionId }),
    onSuccess: invalidate,
  });
  const setReferrer = useMutation({
    mutationFn: (referrerId: string | null) => api.setLeadReferrer(leadId, { referrerId }),
    onSuccess: invalidate,
  });
  const completeContact = useMutation({
    mutationFn: (outcome: "done" | "cancelled") =>
      api.completeNextContact(leadId, { outcome }),
    onSuccess: () => {
      setNextContact(null);
      setNextType(null);
      invalidate();
    },
  });
  const saveNextContact = useMutation({
    mutationFn: (v: { at: string | null; typeId: string | null }) =>
      api.updateNextContact(leadId, {
        nextContactAt: v.at ? new Date(v.at).toISOString() : null,
        nextContactTypeId: v.typeId || null,
      }),
    onSuccess: () => {
      setNextContact(null);
      setNextType(null);
      invalidate();
    },
  });
  const addNote = useMutation({
    mutationFn: () => api.addNote(leadId, { text: noteText.trim() }),
    onSuccess: () => {
      setNoteText("");
      invalidate();
    },
  });
  const editNote = useMutation({
    mutationFn: (v: { id: string; text: string }) =>
      api.updateNote(v.id, { text: v.text.trim() }),
    onSuccess: () => {
      setEditingNoteId(null);
      invalidate();
    },
  });
  const removeNote = useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: invalidate,
  });

  if (lead.isLoading) return <p className="hint">Загрузка…</p>;
  if (lead.error || !lead.data) {
    return (
      <div>
        <button className="btn-ghost" onClick={onBack}>
          ← к списку
        </button>
        <p className="alert alert-error" role="alert" style={{ marginTop: "1rem" }}>
          {(lead.error as Error)?.message ?? "Заявка не найдена"}
        </p>
      </div>
    );
  }

  const d = lead.data;
  const editable = canEditLead(user, d);
  const currentNextContact =
    nextContact !== null ? nextContact : toLocalInput(d.nextContactAt);
  const currentNextType =
    nextType !== null ? nextType : d.nextContactTypeId ?? "";
  const liveTypes = contactTypes.data ?? [];
  // Если у заявки тип, которого нет среди живых (архивный) — добавим заглушку,
  // чтобы select оставался управляемым и не «терял» значение.
  const typeMissing =
    currentNextType !== "" && !liveTypes.some((t) => t.id === currentNextType);
  // Этапы только воронки самой заявки — чтобы не уводить её в чужую воронку.
  const funnelStages = stages.filter((s) => s.funnelId === d.stage.funnelId);
  const liveStage = funnelStages.some((s) => s.id === d.stageId);
  const funnelName = funnels.find((f) => f.id === d.stage.funnelId)?.name ?? null;
  const projectOptions = projects.data ?? [];
  const projectMissing =
    d.constructionId !== null && !projectOptions.some((p) => p.id === d.constructionId);
  // Цвет этапа для пилюли в шапке (у архивного этапа токена нет — без точки).
  const stageColor = stages.find((s) => s.id === d.stageId)?.color;
  const isActive = d.stage.kind === "in_progress";
  // Возраст сделки для шапки: сколько дней прошло с поступления.
  const ageDays = Math.max(
    1,
    Math.ceil((Date.now() - new Date(d.createdAt).getTime()) / 86400000),
  );
  // Бейдж статуса задачи (просрочено/сегодня/завтра/дата) — по дню МСК, как в
  // «Моём дне»; без даты — приглашение назначить.
  const taskBadge = d.nextContactAt ? nextContactBadge(d.nextContactAt) : null;

  const copyPhone = () => {
    void copyToClipboard(d.phone);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const setQuickNextContact = (days: number) => {
    const next = new Date();
    next.setDate(next.getDate() + days);
    next.setHours(10, 0, 0, 0);
    setNextContact(toLocalInput(next.toISOString()));
  };

  // Ответственный: «Вы» / почта менеджера (админу) / «Другой менеджер» / «Не назначен».
  const assigneeView = () => {
    if (!d.assigneeId) {
      return <span className="muted">Не назначен (в общей очереди)</span>;
    }
    if (d.assigneeId === user.id) {
      return <span className="badge badge-info">Вы</span>;
    }
    const u = userById.get(d.assigneeId);
    if (u) {
      return (
        <span title={u.email}>
          {u.name || u.email}
          {!u.isActive && <span className="subtle"> (заблокирован)</span>}
        </span>
      );
    }
    return <span className="muted">Другой менеджер</span>;
  };

  // Подпись автора события: имя/почта (по справочнику или из самого события).
  const authorLabel = (authorId: string | null, authorEmail: string | null): string => {
    if (!authorId) return "система";
    const u = userById.get(authorId);
    return u?.name || u?.email || authorEmail || "—";
  };

  const contactTitle = (
    kind: ContactTimelineItem["kind"],
    at: string | null,
    typeName: string | null,
  ): string => {
    const what = at ? `${typeName ? `${typeName}, ` : ""}${formatDateTime(at)}` : "";
    if (kind === "done") return `выполнен: ${what}`;
    if (kind === "cancelled" || kind === "missed") return `отменён: ${what}`;
    if (kind === "cleared") return "напоминание снято";
    return what || "контакт назначен";
  };

  // Единая лента активности: этапы + заметки + назначения, по времени (новые сверху).
  const activity: ActivityItem[] = [
    ...d.statusHistory.map((ev) => ({
      id: `stage-${ev.id}`,
      at: ev.createdAt,
      kind: "stage" as const,
      title: ev.stage.name,
      author: authorLabel(ev.authorId, ev.authorEmail),
    })),
    ...d.notes.map((n) => ({
      id: `note-${n.id}`,
      at: n.createdAt,
      kind: "note" as const,
      title: n.text,
      author: authorLabel(n.authorId, n.authorEmail),
    })),
    ...d.assignHistory.map((ev) => ({
      id: `assign-${ev.id}`,
      at: ev.createdAt,
      kind: "assign" as const,
      title:
        ev.assigneeId === null
          ? "возвращена в общую очередь"
          : ev.assigneeId === user.id
            ? "назначена вам"
            : `назначена: ${ev.assigneeLabel ?? "менеджер"}`,
      author: authorLabel(ev.authorId, ev.authorEmail),
    })),
    ...d.contactHistory.map((ev) => {
      return {
        id: `contact-${ev.id}`,
        at: ev.createdAt,
        kind: "contact" as const,
        title: contactTitle(ev.kind, ev.at, ev.typeName),
        author: authorLabel(ev.authorId, ev.authorEmail),
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const currentTypeName =
    d.nextContactTypeId
      ? liveTypes.find((t) => t.id === d.nextContactTypeId)?.name ??
        d.contactHistory
          .filter((ev) => ev.kind === "scheduled" && ev.at === d.nextContactAt)
          .at(-1)?.typeName ??
        "тип из архива"
      : null;
  const contactTimeline: ContactTimelineItem[] = [
    ...(d.nextContactAt
      ? [
          {
            id: "current",
            kind: "pending" as const,
            at: d.nextContactAt,
            createdAt: d.nextContactAt,
            title: contactTitle("scheduled", d.nextContactAt, currentTypeName),
            author: "назначен",
          },
        ]
      : []),
    ...d.contactHistory
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((ev) => ({
        id: ev.id,
        kind: ev.kind,
        at: ev.at,
        createdAt: ev.createdAt,
        title: contactTitle(ev.kind, ev.at, ev.typeName),
        author: authorLabel(ev.authorId, ev.authorEmail),
      })),
  ];

  const nextContactSection = isActive ? (
    <Section
      title="Следующий контакт"
      badge={
        taskBadge ? (
          <span className={`badge badge-${taskBadge.tone}`}>{taskBadge.label}</span>
        ) : (
          <span className="badge badge-neutral">не назначен</span>
        )
      }
    >
      {editable && (
        <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
          <button type="button" className="btn-sm" onClick={() => setQuickNextContact(0)}>
            Сегодня
          </button>
          <button type="button" className="btn-sm" onClick={() => setQuickNextContact(1)}>
            Завтра
          </button>
          <button type="button" className="btn-sm" onClick={() => setQuickNextContact(3)}>
            +3 дня
          </button>
        </div>
      )}
      <input
        type="datetime-local"
        disabled={!editable}
        value={currentNextContact}
        onChange={(e) => setNextContact(e.target.value)}
        style={{ width: "100%" }}
      />
      <select
        disabled={!editable}
        value={currentNextType}
        onChange={(e) => setNextType(e.target.value)}
        style={{ width: "100%", marginTop: 8 }}
      >
        <option value="">— тип контакта —</option>
        {liveTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        {typeMissing && <option value={currentNextType}>(архивный тип)</option>}
      </select>
      {editable && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="btn-primary"
            disabled={!currentNextContact || saveNextContact.isPending}
            onClick={() =>
              saveNextContact.mutate({ at: currentNextContact, typeId: currentNextType })
            }
          >
            Сохранить
          </button>
          {d.nextContactAt && (
            <button
              type="button"
              onClick={() => saveNextContact.mutate({ at: null, typeId: null })}
              disabled={saveNextContact.isPending}
            >
              Снять
            </button>
          )}
        </div>
      )}
      <ContactTimeline
        items={contactTimeline}
        editable={editable}
        pending={completeContact.isPending}
        onDone={() => completeContact.mutate("done")}
        onCancel={() => completeContact.mutate("cancelled")}
      />
    </Section>
  ) : null;

  return (
    <div className="lead-detail">
      <button className="btn-ghost" onClick={onBack} style={{ marginBottom: "1rem" }}>
        ← к списку
      </button>

      <div style={{ marginBottom: "1.25rem" }}>
        <h2
          className="row wrap"
          style={{ alignItems: "center", gap: 8, margin: "0 0 0.45rem" }}
        >
          {d.name}
          <span className="lead-stage-pill">
            {stageColor && (
              <span
                className="lead-stage-dot"
                style={{ background: STAGE_COLOR_HEX[stageColor] }}
                aria-hidden="true"
              />
            )}
            {d.stage.name}
          </span>
          {d.isRepeat && <span className="badge badge-warn">повторная</span>}
          {!editable && <span className="badge badge-neutral">только чтение</span>}
        </h2>
        <div className="row wrap" style={{ gap: 14, color: "var(--fg-muted)", fontSize: 14 }}>
          <span className="row" style={{ gap: 6 }}>
            <a className="tnum lead-phone" href={`tel:${d.phone}`}>
              {d.phone}
            </a>
            <button
              type="button"
              className="btn-sm"
              onClick={copyPhone}
              title="Скопировать телефон"
            >
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </span>
          <span>{d.sourceName ?? sourceLabel(d.source)}</span>
          {d.constructionName && <span>{d.constructionName}</span>}
          <span className="subtle">
            от {formatDateTime(d.createdAt)}
            {isActive ? ` · в работе ${ageDays} дн.` : " · закрыта"}
          </span>
        </div>
      </div>

      <div className="lead-layout">
        {/* Левая сторона — техническая информация по сделке. */}
        <div className="lead-col">
          {/* Все поля сделки — одной карточкой (вместо россыпи мини-карточек). */}
          <Section title="Сделка">
            <div className="settings-grid">
              <div className="field">
                <div className="field-label">Воронка</div>
                <div className="field-value">{funnelName ?? "—"}</div>
              </div>
              <div className="field">
                <div className="field-label">Этап</div>
                <select
                  disabled={!editable}
                  value={liveStage ? d.stageId : ""}
                  onChange={(e) => changeStage.mutate(e.target.value)}
                >
                  {!liveStage && <option value="">{d.stage.name} (архив)</option>}
                  {funnelStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field field-wide">
                <div className="field-label">Ответственный</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {assigneeView()}
                  {editable && d.assigneeId !== user.id && user.role !== "admin" && (
                    <button className="btn-sm" onClick={() => assign.mutate(user.id)}>
                      Взять себе
                    </button>
                  )}
                  {editable && d.assigneeId && (
                    <button className="btn-sm" onClick={() => assign.mutate(null)}>
                      Вернуть в очередь
                    </button>
                  )}
                </div>
                {user.role === "admin" && (
                  <select
                    value={d.assigneeId ?? ""}
                    onChange={(e) => assign.mutate(e.target.value || null)}
                    style={{ marginTop: 8 }}
                    aria-label="Назначить менеджера"
                  >
                    <option value="">Не назначен (общая очередь)</option>
                    {managerOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ? `${m.name} (${m.email})` : m.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="field">
                <div className="field-label">Источник</div>
                {editable ? (
                  <select
                    value={d.source}
                    onChange={(e) => changeSource.mutate(e.target.value)}
                  >
                    {/* Текущий источник мог уйти в архив — не «теряем» значение. */}
                    {sources.data &&
                      !sources.data.some((s) => s.id === d.source) && (
                        <option value={d.source}>
                          {d.sourceName ?? sourceLabel(d.source)} (архив)
                        </option>
                      )}
                    {(sources.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="field-value">{d.sourceName ?? sourceLabel(d.source)}</div>
                )}
              </div>

              <div className="field">
                <div className="field-label">Клиент</div>
                <div className="field-value">
                  {d.contactId ? (
                    <button className="link-btn" onClick={() => navigate(`/contacts/${d.contactId}`)}>
                      {d.contactName ?? d.name}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              </div>

              <div className="field">
                <div className="field-label">Конструкция</div>
                {editable ? (
                  <>
                    <select
                      value={d.constructionId ?? ""}
                      onChange={(e) => changeProject.mutate(e.target.value || null)}
                      disabled={changeProject.isPending || projects.isLoading}
                    >
                      <option value="">— не выбран —</option>
                      {projectMissing && d.constructionId && (
                        <option value={d.constructionId}>{d.constructionName ?? d.constructionId} (архив)</option>
                      )}
                      {projectOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {changeProject.error && (
                      <p className="alert alert-error" role="alert" style={{ marginTop: 8 }}>
                        {(changeProject.error as Error).message}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="field-value">
                    {d.constructionId ? d.constructionName ?? d.constructionId : <span className="muted">—</span>}
                  </div>
                )}
              </div>

              <div className="field field-wide" style={{ marginBottom: 0 }}>
                <div className="field-label">Партнёр, который привёл клиента</div>
                {editable ? (
                  <>
                    <select
                      value={d.referrerId ?? ""}
                      onChange={(e) => setReferrer.mutate(e.target.value || null)}
                      disabled={setReferrer.isPending}
                    >
                      <option value="">— без реферера —</option>
                      {d.referrerId &&
                        d.referrer &&
                        partners.data &&
                        companies.data &&
                        !partners.data.some((r) => r.id === d.referrerId) &&
                        !companies.data.some((a) => a.id === d.referrerId) && (
                          <option value={d.referrerId}>{d.referrer.fullName} (архив)</option>
                        )}
                      {(partners.data ?? []).length > 0 && (
                        <optgroup label="Партнёры">
                          {(partners.data ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.fullName}
                              {r.organizationName ? ` (${r.organizationName})` : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {(companies.data ?? []).length > 0 && (
                        <optgroup label="Компании">
                          {(companies.data ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.fullName}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {setReferrer.error && (
                      <p className="alert alert-error" role="alert" style={{ marginTop: 8 }}>
                        {(setReferrer.error as Error).message}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="field-value">
                    {d.referrer ? (
                      <>
                        {d.referrer.fullName}
                        <span className="subtle">
                          {" "}
                          · {d.referrer.type === "company" ? "компания" : "партнёр"}
                        </span>
                      </>
                    ) : (
                      <span className="muted">не указан</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Section>
        </div>

        {/* Правая сторона — общение: сообщение, заметки, история, связанные. */}
        <div className="lead-col">
          {d.message && (
            <Section title="Сообщение">
              <div style={{ whiteSpace: "pre-wrap" }}>{d.message}</div>
            </Section>
          )}

          {nextContactSection}

          <Section title="Заметки">
        {d.notes.length === 0 && <p className="empty">Заметок нет.</p>}
        {d.notes.map((n) => {
          const mine = n.authorId === user.id || user.role === "admin";
          return (
            <div
              key={n.id}
              style={{ borderBottom: "1px solid var(--border-soft)", padding: "0.6rem 0" }}
            >
              <div className="row wrap" style={{ gap: 8, fontSize: 12, color: "var(--fg-subtle)" }}>
                <span>{n.authorEmail}</span>
                <span>{formatDateTime(n.createdAt)}</span>
              </div>
              {editingNoteId === n.id ? (
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <input
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn-primary"
                    onClick={() => editNote.mutate({ id: n.id, text: editingText })}
                  >
                    Сохранить
                  </button>
                  <button onClick={() => setEditingNoteId(null)}>Отмена</button>
                </div>
              ) : (
                <div className="row" style={{ justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                  <span style={{ whiteSpace: "pre-wrap" }}>{n.text}</span>
                  {mine && (
                    <span className="row" style={{ gap: 12, flexShrink: 0 }}>
                      <button
                        className="link-btn"
                        onClick={() => {
                          setEditingNoteId(n.id);
                          setEditingText(n.text);
                        }}
                      >
                        ред.
                      </button>
                      <button
                        className="link-btn danger"
                        onClick={() => {
                          if (window.confirm("Удалить заметку безвозвратно?")) {
                            removeNote.mutate(n.id);
                          }
                        }}
                      >
                        удалить
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {editable && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (noteText.trim()) addNote.mutate();
            }}
            className="row"
            style={{ gap: 8, marginTop: 12 }}
          >
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Добавить заметку…"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn-primary" disabled={addNote.isPending}>
              Добавить
            </button>
          </form>
        )}
      </Section>

          <DealSection leadId={leadId} detail={d} editable={editable} />

          <CollapsibleSection
            title="Активность"
            count={activity.length}
            defaultOpen
          >
            {activity.length === 0 && <p className="empty">Пока пусто.</p>}
            <ActivityFeed items={activity} initialLimit={3} />
          </CollapsibleSection>

          {d.related.length > 0 && (
            <CollapsibleSection
              title="Связанные заявки по телефону"
              count={d.related.length}
            >
              {d.related.map((r) => (
                <div key={r.id} style={{ padding: "0.3rem 0" }}>
                  <button className="link-btn" onClick={() => onOpenRelated(r.id)}>
                    {formatDateTime(r.createdAt)} · {sourceLabel(r.source)} · {r.stage.name}
                  </button>
                </div>
              ))}
            </CollapsibleSection>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityFeed({
  items,
  initialLimit,
}: {
  items: ActivityItem[];
  initialLimit: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, initialLimit);

  return (
    <>
      <ul className="activity-feed">
        {visible.map((a) => (
          <li key={a.id} className={`activity-item activity-${a.kind}`}>
            <span className="activity-dot" aria-hidden="true" />
            <div className="activity-body">
              <div className="activity-line">
                <span className="activity-kind">
                  {a.kind === "stage"
                    ? "Этап"
                    : a.kind === "note"
                      ? "Заметка"
                      : a.kind === "assign"
                        ? "Ответственный"
                        : "Контакт"}
                </span>
                <span
                  className={a.kind === "note" ? "" : "activity-strong"}
                  style={a.kind === "note" ? { whiteSpace: "pre-wrap" } : undefined}
                >
                  {a.title}
                </span>
              </div>
              <div className="activity-meta">
                <span className="tnum">{formatDateTime(a.at)}</span>
                <span>·</span>
                <span>{a.author}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {items.length > initialLimit && (
        <button
          type="button"
          className="link-btn lead-show-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Скрыть" : `Показать ещё ${items.length - initialLimit}`}
        </button>
      )}
    </>
  );
}

function ContactTimeline({
  items,
  editable,
  pending,
  onDone,
  onCancel,
}: {
  items: ContactTimelineItem[];
  editable: boolean;
  pending: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) {
    return <p className="empty" style={{ marginTop: 12 }}>Контактов пока нет.</p>;
  }
  const initialLimit = 3;
  const visible = expanded ? items : items.slice(0, initialLimit);

  return (
    <div className="next-contact-list">
      <ul className="activity-feed">
        {visible.map((item) => {
          const isCurrent = item.kind === "pending";
          return (
            <li
              key={item.id}
              className={`activity-item activity-contact next-contact-item${
                isCurrent ? " next-contact-item-current" : ""
              }`}
            >
              <span className="activity-dot" aria-hidden="true" />
              <div className="activity-body next-contact-body">
                <div>
                  <div className="activity-line">
                    <span className="activity-kind">Контакт</span>
                    <span className="activity-strong">{item.title}</span>
                  </div>
                  <div className="activity-meta">
                    <span className="tnum">
                      {item.at ? formatDateTime(item.at) : formatDateTime(item.createdAt)}
                    </span>
                    <span>·</span>
                    <span>{item.author}</span>
                  </div>
                </div>
                {isCurrent && editable && (
                  <div className="next-contact-actions">
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={pending}
                      onClick={onDone}
                      title="Отметить контакт выполненным и снять напоминание"
                    >
                      Выполнен
                    </button>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={pending}
                      onClick={onCancel}
                      title="Отменить контакт и снять напоминание"
                    >
                      Отмена
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > initialLimit && (
        <button
          type="button"
          className="link-btn lead-show-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Скрыть" : `Показать ещё ${items.length - initialLimit}`}
        </button>
      )}
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  /** Бейдж рядом с заголовком (напр. «просрочено»). */
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-body">
        <h3 className="section-title">
          {title}
          {badge && <span style={{ marginLeft: 8 }}>{badge}</span>}
        </h3>
        {children}
      </div>
    </section>
  );
}

/**
 * Сворачиваемый блок карточки (история, связанные). По умолчанию свёрнут, чтобы
 * правая колонка не превращалась в простыню; в шапке — счётчик записей.
 */
function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="card lead-collapse" open={defaultOpen}>
      <summary className="lead-collapse-summary">
        <span className="lead-collapse-chevron" aria-hidden="true">
          ›
        </span>
        <h3 className="section-title" style={{ margin: 0 }}>
          {title}
        </h3>
        {count != null && <span className="lead-collapse-count">{count}</span>}
      </summary>
      <div className="card-body" style={{ paddingTop: "0.4rem" }}>
        {children}
      </div>
    </details>
  );
}
