import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Lead, SessionUser, Stage } from "@noesis/contracts";
import { api, type LeadListParams, type PaginatedLeads } from "../api/client";
import { canEditLead, formatDateTime, sourceLabel } from "./shared";

/** Фильтры доски (тот же набор, что у списка, но без этапа — им служат колонки). */
export interface BoardFilters {
  funnelId?: string;
  source?: string;
  constructionId?: string;
  assigneeId?: string;
  from?: string;
  to?: string;
  search?: string;
}

// Доска поднимает заявки сразу по всем этапам одним запросом (см. лимит в контракте).
const BOARD_LIMIT = 500;

export function KanbanBoard({
  stages,
  user,
  filters,
  onOpen,
  assigneeName,
}: {
  stages: Stage[];
  user: SessionUser;
  filters: BoardFilters;
  onOpen: (id: string) => void;
  /** Имя/почта ответственного по id (админу; менеджеру справочник недоступен). */
  assigneeName?: (id: string) => string | undefined;
}) {
  const qc = useQueryClient();
  const params: LeadListParams = { ...filters, page: 1, pageSize: BOARD_LIMIT };
  const key = ["leads", "board", params] as const;

  const q = useQuery({ queryKey: key, queryFn: () => api.listLeads(params), retry: false });
  const [activeId, setActiveId] = useState<string | null>(null);
  // Терминальные колонки (won/lost) по умолчанию свёрнуты — они длинные и редко
  // нужны в потоке работы; admin/менеджер разворачивает их кликом.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(stages.filter((s) => s.kind !== "in_progress").map((s) => s.id)),
  );
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Перенос заявки в другую колонку. Оптимистично двигаем карточку в кэше доски,
  // при ошибке откатываем; затем инвалидируем список и счётчики.
  const move = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      api.updateLeadStage(id, { stageId }),
    onMutate: async ({ id, stageId }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PaginatedLeads>(key);
      const target = stages.find((s) => s.id === stageId);
      qc.setQueryData<PaginatedLeads>(key, (old) =>
        old && target
          ? {
              ...old,
              items: old.items.map((l) =>
                l.id === id
                  ? {
                      ...l,
                      stageId,
                      stage: {
                        id: target.id,
                        name: target.name,
                        kind: target.kind,
                        funnelId: target.funnelId,
                      },
                    }
                  : l,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const sensors = useSensors(
    // distance: клик по имени (и мелкие сдвиги) не запускают перетаскивание.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  if (q.isLoading) return <p className="hint">Загрузка…</p>;
  if (q.error) {
    return (
      <p className="alert alert-error" role="alert">
        {(q.error as Error).message}
      </p>
    );
  }

  const items = q.data?.items ?? [];
  const byStage = new Map<string, Lead[]>();
  for (const s of stages) byStage.set(s.id, []);
  for (const l of items) {
    const bucket = byStage.get(l.stageId);
    if (bucket) bucket.push(l); // заявки из архивных этапов на доске не показываем
  }
  const activeLead = activeId ? items.find((l) => l.id === activeId) ?? null : null;
  const truncated = (q.data?.total ?? 0) > items.length;

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const id = String(e.active.id);
    const overStage = String(e.over.id);
    const lead = items.find((l) => l.id === id);
    if (!lead || lead.stageId === overStage || !canEditLead(user, lead)) return;
    move.mutate({ id, stageId: overStage });
  };

  return (
    <>
      {truncated && (
        <p className="hint" style={{ marginBottom: "0.75rem" }}>
          Показаны последние {items.length} из {q.data?.total} заявок по фильтрам — уточните
          фильтр, чтобы увидеть остальные.
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="kanban">
          {stages.map((s) => (
            <Column
              key={s.id}
              stage={s}
              leads={byStage.get(s.id) ?? []}
              user={user}
              onOpen={onOpen}
              assigneeName={assigneeName}
              collapsed={collapsed.has(s.id)}
              onToggle={() => toggleCollapsed(s.id)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeLead ? (
            <div className="kanban-card is-overlay">
              <CardBody lead={activeLead} user={user} assigneeName={assigneeName} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function Column({
  stage,
  leads,
  user,
  onOpen,
  collapsed,
  onToggle,
  assigneeName,
}: {
  stage: Stage;
  leads: Lead[];
  user: SessionUser;
  onOpen: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  assigneeName?: (id: string) => string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section
      ref={setNodeRef}
      className={`kanban-col stage-c-${stage.color}${collapsed ? " is-collapsed" : ""}${
        isOver ? " is-over" : ""
      }`}
    >
      <header className="kanban-col-head">
        <button
          type="button"
          className="kanban-col-toggle"
          aria-label={collapsed ? "Развернуть колонку" : "Свернуть колонку"}
          aria-expanded={!collapsed}
          title={collapsed ? "Развернуть" : "Свернуть"}
          onClick={onToggle}
        >
          {collapsed ? "›" : "‹"}
        </button>
        <span className="kanban-col-title">{stage.name}</span>
        <span className="kanban-col-count">{leads.length}</span>
      </header>
      {!collapsed && (
        <div className="kanban-col-body">
          {leads.map((l) => (
            <DraggableCard
              key={l.id}
              lead={l}
              user={user}
              onOpen={onOpen}
              assigneeName={assigneeName}
            />
          ))}
          {leads.length === 0 && <div className="kanban-empty">Перетащите заявку сюда</div>}
        </div>
      )}
    </section>
  );
}

function DraggableCard({
  lead,
  user,
  onOpen,
  assigneeName,
}: {
  lead: Lead;
  user: SessionUser;
  onOpen: (id: string) => void;
  assigneeName?: (id: string) => string | undefined;
}) {
  const editable = canEditLead(user, lead);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    disabled: !editable,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kanban-card${isDragging ? " is-dragging" : ""}${editable ? "" : " is-readonly"}`}
      {...attributes}
      {...listeners}
    >
      <CardBody lead={lead} user={user} onOpen={onOpen} assigneeName={assigneeName} />
    </div>
  );
}

/** Содержимое карточки. С `onOpen` имя — кликабельная кнопка (в оверлее — текст). */
function CardBody({
  lead,
  user,
  onOpen,
  assigneeName,
}: {
  lead: Lead;
  user: SessionUser;
  onOpen?: (id: string) => void;
  assigneeName?: (id: string) => string | undefined;
}) {
  const assignee = lead.assigneeId
    ? lead.assigneeId === user.id
      ? "Вы"
      : assigneeName?.(lead.assigneeId) ?? "другой менеджер"
    : "не назначен";
  const overdue =
    lead.nextContactAt !== null && new Date(lead.nextContactAt).getTime() < Date.now();
  return (
    <>
      <div className="kanban-card-top">
        {onOpen ? (
          <button
            type="button"
            className="link-btn kanban-card-name"
            // не даём перетаскиванию стартовать с имени — клик всегда открывает.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onOpen(lead.id)}
          >
            {lead.name}
          </button>
        ) : (
          <span className="kanban-card-name">{lead.name}</span>
        )}
        {lead.isRepeat && <span className="badge badge-warn">повторная</span>}
      </div>
      <div className="kanban-card-meta">
        <span className="tnum">{lead.phone}</span>
        <span>{lead.sourceName ?? sourceLabel(lead.source)}</span>
      </div>
      <div className="kanban-card-meta">
        <span className="tnum subtle">{formatDateTime(lead.createdAt)}</span>
        <span className="subtle">{assignee}</span>
      </div>
      {lead.nextContactAt && (
        <div className={`kanban-card-due${overdue ? " is-overdue" : ""}`}>
          {overdue ? "Просрочен" : "Контакт"}:{" "}
          {new Date(lead.nextContactAt).toLocaleDateString("ru-RU")}
        </div>
      )}
    </>
  );
}
