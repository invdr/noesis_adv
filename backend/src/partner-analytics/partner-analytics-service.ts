import type {
  PartnerAnalyticsQuery,
  PartnerAnalyticsResponse,
  PartnerRow,
  SessionUser,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { visibilityWhere } from "../leads/lead-visibility";

/** Окно по умолчанию, если период не задан, в днях. */
const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Агрегаты по одному партнёру: счётчики за период + активность за всё время. */
interface PartnerAgg {
  /** Приведённые лиды за период. */
  referred: number;
  /** Из них сделки (текущий этап kind=won) за период. */
  deals: number;
  /** Дата последней активности по приведённым заявкам (all-time), либо null. */
  lastActivity: Date | null;
}

function emptyAgg(): PartnerAgg {
  return { referred: 0, deals: 0, lastActivity: null };
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}

function mergeAgg(a: PartnerAgg, b: PartnerAgg): PartnerAgg {
  return {
    referred: a.referred + b.referred,
    deals: a.deals + b.deals,
    lastActivity: later(a.lastActivity, b.lastActivity),
  };
}

/**
 * Аналитика работы с партнёрами и компаниями. Приведённые лиды и сделки
 * — когорта по дате поступления заявки в периоде `[from, to)`. «Последнее
 * взаимодействие» — либо ручное переопределение контакта, либо максимальная
 * активность по всем его приведённым заявкам за всё время (создание заявки,
 * последняя смена этапа, последняя заметка). Видимость: менеджер считает по
 * своим/неназначенным заявкам, admin — по всем. Строка компании сводит её
 * прямые рефералы и рефералы представителей.
 */
export async function getPartnerAnalytics(
  rt: Runtime,
  user: SessionUser,
  query: PartnerAnalyticsQuery,
): Promise<PartnerAnalyticsResponse> {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);

  // 1. Все приведённые заявки, видимые пользователю (all-time), с последней
  //    сменой этапа и последней заметкой — для last-activity и счётчиков периода.
  const referred = await rt.prisma.lead.findMany({
    where: { AND: [{ referrerId: { not: null } }, visibilityWhere(user)] },
    select: {
      referrerId: true,
      createdAt: true,
      stage: { select: { kind: true } },
      statusEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      notes: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  const byReferrer = new Map<string, PartnerAgg>();
  for (const lead of referred) {
    const rid = lead.referrerId;
    if (!rid) continue;
    const agg = byReferrer.get(rid) ?? emptyAgg();
    if (lead.createdAt >= from && lead.createdAt < to) {
      agg.referred += 1;
      if (lead.stage.kind === "won") agg.deals += 1;
    }
    const times: Date[] = [lead.createdAt];
    if (lead.statusEvents[0]) times.push(lead.statusEvents[0].createdAt);
    if (lead.notes[0]) times.push(lead.notes[0].createdAt);
    for (const t of times) agg.lastActivity = later(agg.lastActivity, t);
    byReferrer.set(rid, agg);
  }

  // 2. Партнёры + их связь с компанией (для свода компаний). Берём всех, в т.ч.
  //    архивных: вклад архивного представителя остаётся в своде компании.
  const partners = await rt.prisma.contact.findMany({
    where: { isPartner: true },
    include: { organization: { select: { fullName: true } } },
  });
  // Партнёры-человеки по компании — для роллапа (включая архивных).
  const representativesByOrganization = new Map<string, typeof partners>();
  for (const p of partners) {
    if (p.type === "individual" && p.organizationId) {
      const arr = representativesByOrganization.get(p.organizationId) ?? [];
      arr.push(p);
      representativesByOrganization.set(p.organizationId, arr);
    }
  }

  // 3. Строки к показу: только живые партнёры, фильтр по типу и поиску.
  const displayTypes = query.type ? [query.type] : ["individual", "company"];
  const term = query.search?.toLowerCase();
  const rows: PartnerRow[] = [];
  for (const p of partners) {
    if (p.archivedAt) continue; // архивных не показываем, но их вклад в свод учтён
    if (!displayTypes.includes(p.type)) continue;
    if (term && !p.fullName.toLowerCase().includes(term)) continue;

    let agg = byReferrer.get(p.id) ?? emptyAgg();
    if (p.type === "company") {
      // Свод: прямые рефералы компании + рефералы её представителей.
      for (const r of representativesByOrganization.get(p.id) ?? []) {
        agg = mergeAgg(agg, byReferrer.get(r.id) ?? emptyAgg());
      }
    }
    // Эффективная дата: ручное переопределение важнее расчётной.
    const effectiveLast = p.lastInteractionAt ?? agg.lastActivity;
    rows.push({
      contactId: p.id,
      fullName: p.fullName,
      type: p.type,
      organizationId: p.organizationId,
      organizationName: p.organization?.fullName ?? null,
      lastInteractionAt: effectiveLast ? effectiveLast.toISOString() : null,
      referredLeads: agg.referred,
      deals: agg.deals,
      conversion: agg.referred ? agg.deals / agg.referred : 0,
    });
  }

  // Сорт: по приведённым за период (убыв.), затем по имени.
  rows.sort((a, b) => b.referredLeads - a.referredLeads || a.fullName.localeCompare(b.fullName));

  return { from: from.toISOString(), to: to.toISOString(), rows };
}
