import type {
  AnalyticsQuery,
  AnalyticsResponse,
  FunnelPoint,
  StageColor,
  StageDurationPoint,
  WeeklyPoint,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { MSK_OFFSET_MS, mskDay, mskWeekStart } from "../http/msk";

/** Окно по умолчанию, если период не задан, в днях. */
const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Событие смены этапа для срезов «во времени». */
type StageEvent = { leadId: string; stageId: string; createdAt: Date };
/** Живой этап (id + имя) в порядке воронки. */
type StageRef = { id: string; name: string };

/**
 * Воронка-водопад: сколько заявок когорты когда-либо достигало каждого этапа
 * (по событиям истории). В порядке воронки. Чистая функция — покрыта тестом.
 */
export function computeFunnel(events: StageEvent[], liveStages: StageRef[]): FunnelPoint[] {
  const reached = new Map<string, Set<string>>(); // stageId → множество leadId
  for (const e of events) {
    let set = reached.get(e.stageId);
    if (!set) reached.set(e.stageId, (set = new Set()));
    set.add(e.leadId);
  }
  return liveStages.map((s) => ({
    stageId: s.id,
    name: s.name,
    reached: reached.get(s.id)?.size ?? 0,
  }));
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Время в этапе: по парам соседних событий каждой заявки (интервал = время в
 * этапе более раннего события), среднее и медиана в часах. Этапы без измеримых
 * переходов (в т.ч. терминальные — из них «выхода» нет) опускаются. Чистая
 * функция — покрыта тестом.
 */
export function computeStageDurations(
  events: StageEvent[],
  liveStages: StageRef[],
): StageDurationPoint[] {
  const byLead = new Map<string, StageEvent[]>();
  for (const e of events) {
    const arr = byLead.get(e.leadId);
    if (arr) arr.push(e);
    else byLead.set(e.leadId, [e]);
  }
  const hoursByStage = new Map<string, number[]>();
  for (const arr of byLead.values()) {
    arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < arr.length - 1; i++) {
      const hours = (arr[i + 1]!.createdAt.getTime() - arr[i]!.createdAt.getTime()) / HOUR_MS;
      if (hours < 0) continue; // защита от рассинхрона времени
      const list = hoursByStage.get(arr[i]!.stageId);
      if (list) list.push(hours);
      else hoursByStage.set(arr[i]!.stageId, [hours]);
    }
  }
  const out: StageDurationPoint[] = [];
  for (const s of liveStages) {
    const list = hoursByStage.get(s.id);
    if (!list || list.length === 0) continue;
    const avg = list.reduce((a, b) => a + b, 0) / list.length;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    out.push({ stageId: s.id, name: s.name, avgHours: round1(avg), medianHours: round1(median) });
  }
  return out;
}

/** Следующая неделя (понедельник) для строки `YYYY-MM-DD`. */
function nextWeek(weekStart: string): string {
  return new Date(new Date(`${weekStart}T00:00:00.000Z`).getTime() + 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Динамика по неделям МСК: `created` — по дате поступления заявки, `won`/`lost` —
 * по дате терминального события. Недели между первой и последней наблюдаемой
 * заполняются нулями. Чистая функция — покрыта тестом.
 */
export function computeWeekly(
  leads: { createdAt: Date }[],
  terminalEvents: { createdAt: Date; kind: "won" | "lost" }[],
): WeeklyPoint[] {
  const created = new Map<string, number>();
  const won = new Map<string, number>();
  const lost = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const l of leads) bump(created, mskWeekStart(l.createdAt));
  for (const e of terminalEvents) bump(e.kind === "won" ? won : lost, mskWeekStart(e.createdAt));

  const keys = [...created.keys(), ...won.keys(), ...lost.keys()].sort();
  if (keys.length === 0) return [];
  const last = keys[keys.length - 1]!;
  const out: WeeklyPoint[] = [];
  // Защитный потолок итераций (~10 лет недель) от рассинхрона дат.
  for (let cursor = keys[0]!, i = 0; cursor <= last && i < 520; cursor = nextWeek(cursor), i++) {
    out.push({
      weekStart: cursor,
      created: created.get(cursor) ?? 0,
      won: won.get(cursor) ?? 0,
      lost: lost.get(cursor) ?? 0,
    });
  }
  return out;
}

/** Все дни МСК в диапазоне [from, to], с нулями там, где заявок не было. */
function fillDays(
  from: Date,
  to: Date,
  counts: Map<string, number>,
): { date: string; count: number }[] {
  const start = new Date(from.getTime() + MSK_OFFSET_MS);
  start.setUTCHours(0, 0, 0, 0);
  // `to` — верхняя граница ИСКЛЮЧИТЕЛЬНО (`createdAt < to`), поэтому последний
  // день периода — это день последнего попадающего инстанта (`to − 1 мс`).
  // Иначе при ровной полуночи МСК справа появлялась бы лишняя пустая колонка.
  const end = new Date(to.getTime() - 1 + MSK_OFFSET_MS);
  end.setUTCHours(0, 0, 0, 0);
  const out: { date: string; count: number }[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

/**
 * Дашборд аналитики (admin). Период когортный — по дате поступления заявки
 * (`createdAt ∈ [from, to)`). Все срезы считаются по одной когорте; конверсия и
 * «по менеджерам» — по текущему этапу/ответственному. Объём данных небольшой
 * (один офис продаж), поэтому агрегируем в памяти.
 */
export async function getAnalytics(
  rt: Runtime,
  query: AnalyticsQuery,
): Promise<AnalyticsResponse> {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);

  const leads = await rt.prisma.lead.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: {
      id: true,
      source: true,
      constructionId: true,
      createdAt: true,
      assigneeId: true,
      stage: { select: { id: true, name: true, kind: true } },
    },
  });
  const total = leads.length;

  // По этапам — zero-fill по живым этапам в порядке воронки.
  const liveStages = await rt.prisma.stage.findMany({
    where: { archivedAt: null },
    orderBy: { order: "asc" },
  });
  const stageCounts = new Map<string, number>();
  for (const l of leads) {
    stageCounts.set(l.stage.id, (stageCounts.get(l.stage.id) ?? 0) + 1);
  }
  const byStage = liveStages.map((s) => ({
    stageId: s.id,
    name: s.name,
    kind: s.kind,
    color: s.color as StageColor,
    count: stageCounts.get(s.id) ?? 0,
  }));

  // По источникам (имена из справочника; удалённый источник — сырой id).
  const sourceCounts = new Map<string, number>();
  for (const l of leads) {
    sourceCounts.set(l.source, (sourceCounts.get(l.source) ?? 0) + 1);
  }
  const sourceRows = sourceCounts.size
    ? await rt.prisma.leadSource.findMany({
        where: { id: { in: [...sourceCounts.keys()] } },
        select: { id: true, name: true },
      })
    : [];
  const sourceName = new Map(sourceRows.map((r) => [r.id, r.name]));
  const bySource = [...sourceCounts.entries()]
    .map(([source, count]) => ({
      source,
      name: sourceName.get(source) ?? null,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // По конструкции (только заявки с привязкой).
  const projectCounts = new Map<string, number>();
  for (const l of leads) {
    if (l.constructionId) {
      projectCounts.set(l.constructionId, (projectCounts.get(l.constructionId) ?? 0) + 1);
    }
  }
  const projects = projectCounts.size
    ? await rt.prisma.construction.findMany({
        where: { id: { in: [...projectCounts.keys()] } },
        select: { id: true, name: true },
      })
    : [];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const byProject = [...projectCounts.entries()]
    .map(([projectId, count]) => ({
      projectId,
      name: projectName.get(projectId) ?? "(удалён)",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Конверсия — по текущему этапу (kind).
  let won = 0;
  let lost = 0;
  let inProgress = 0;
  for (const l of leads) {
    if (l.stage.kind === "won") won++;
    else if (l.stage.kind === "lost") lost++;
    else inProgress++;
  }
  const closed = won + lost;
  const conversion = {
    won,
    lost,
    inProgress,
    wonRate: total ? won / total : 0,
    closeRate: closed ? won / closed : 0,
  };

  // Динамика по дням (МСК).
  const dayCounts = new Map<string, number>();
  for (const l of leads) {
    const day = mskDay(l.createdAt);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const daily = fillDays(from, to, dayCounts);

  // По менеджерам — по текущему ответственному. Заявки без ответственного либо
  // закреплённые за админом сводим в строку «не распределено» (ключ null).
  const assigneeIds = [
    ...new Set(leads.map((l) => l.assigneeId).filter((v): v is string => !!v)),
  ];
  const users = assigneeIds.length
    ? await rt.prisma.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, email: true, name: true, role: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const managerAgg = new Map<string | null, { leads: number; won: number }>();
  for (const l of leads) {
    const u = l.assigneeId ? userById.get(l.assigneeId) : undefined;
    const key = u && u.role === "manager" ? u.id : null;
    const cur = managerAgg.get(key) ?? { leads: 0, won: 0 };
    cur.leads++;
    if (l.stage.kind === "won") cur.won++;
    managerAgg.set(key, cur);
  }
  // Активность: отработанные контакты (done/cancelled + старые missed) за период — по автору
  // события, независимо от когорты заявок (метрика «сколько касаний сделал»).
  const contactEvents = await rt.prisma.leadContactEvent.findMany({
    where: { createdAt: { gte: from, lt: to }, kind: { in: ["done", "cancelled", "missed"] } },
    select: { authorId: true },
  });
  const contactsByAuthor = new Map<string, number>();
  for (const e of contactEvents) {
    if (!e.authorId) continue;
    contactsByAuthor.set(e.authorId, (contactsByAuthor.get(e.authorId) ?? 0) + 1);
  }
  const byManager = [...managerAgg.entries()]
    .map(([key, v]) => ({
      assigneeId: key,
      email: key ? userById.get(key)?.email ?? null : null,
      name: key ? userById.get(key)?.name ?? null : null,
      leads: v.leads,
      won: v.won,
      contacts: key ? contactsByAuthor.get(key) ?? 0 : 0,
    }))
    // Менеджеры по убыванию заявок, «не распределено» — в конце.
    .sort(
      (a, b) =>
        (a.assigneeId === null ? 1 : 0) - (b.assigneeId === null ? 1 : 0) ||
        b.leads - a.leads,
    );

  // --- Срезы «во времени» (по событиям истории смены этапов) ---
  const cohortIds = leads.map((l) => l.id);
  const events: StageEvent[] = cohortIds.length
    ? await rt.prisma.leadStatusEvent.findMany({
        where: { leadId: { in: cohortIds } },
        select: { leadId: true, stageId: true, createdAt: true },
      })
    : [];
  // Карта kind по ВСЕМ этапам (включая архивные): терминальное событие могло
  // произойти на этапе, который потом архивировали.
  const allStageKinds = await rt.prisma.stage.findMany({
    select: { id: true, kind: true },
  });
  const stageKind = new Map(allStageKinds.map((s) => [s.id, s.kind]));

  const funnel = computeFunnel(events, liveStages);
  const stageDuration = computeStageDurations(events, liveStages);

  // Динамика по неделям: `weekly` фильтруется источником (прочие срезы — нет).
  const weeklyLeads = query.source ? leads.filter((l) => l.source === query.source) : leads;
  const weeklyIds = new Set(weeklyLeads.map((l) => l.id));
  // На заявку — последнее событие входа в терминальный этап (won/lost).
  const lastTerminal = new Map<string, { createdAt: Date; kind: "won" | "lost" }>();
  for (const e of events) {
    if (!weeklyIds.has(e.leadId)) continue;
    const kind = stageKind.get(e.stageId);
    if (kind !== "won" && kind !== "lost") continue;
    const prev = lastTerminal.get(e.leadId);
    if (!prev || e.createdAt > prev.createdAt) {
      lastTerminal.set(e.leadId, { createdAt: e.createdAt, kind });
    }
  }
  const weekly = computeWeekly(weeklyLeads, [...lastTerminal.values()]);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    total,
    byStage,
    bySource,
    byProject,
    conversion,
    daily,
    byManager,
    funnel,
    stageDuration,
    weekly,
  };
}
