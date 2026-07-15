import { Prisma } from "@prisma/client";
import {
  FINANCE_TOTAL_BPS,
  allocateByShares,
  monthOfDate,
  nextMonth,
  shareActiveInMonth,
  type FinanceAllocation,
  type FinanceDistribution,
  type FinanceParticipantBalance,
  type FinanceParticipantKind,
  type FinanceSummary,
  type Month,
  type SessionUser,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { dateToMonth, monthToDate } from "./finance-dto";

/** Потолок окна списка распределений/сводки, чтобы не строить сотни месяцев. */
const MAX_MONTHS_WINDOW = 60;

interface MonthTotals {
  totalIncome: number;
  totalExpense: number;
  netIncome: number;
}

/** Поступления (все) минус подтверждённые расходы за календарный месяц. */
async function monthTotals(
  db: Prisma.TransactionClient | Runtime["prisma"],
  month: Month,
): Promise<MonthTotals> {
  const start = monthToDate(month);
  const end = monthToDate(nextMonth(month));
  const [income, expense] = await Promise.all([
    db.financeIncome.aggregate({
      _sum: { amount: true },
      where: { date: { gte: start, lt: end } },
    }),
    db.financeExpense.aggregate({
      _sum: { amount: true },
      where: { status: "confirmed", date: { gte: start, lt: end } },
    }),
  ]);
  const totalIncome = income._sum.amount ?? 0;
  const totalExpense = expense._sum.amount ?? 0;
  return { totalIncome, totalExpense, netIncome: totalIncome - totalExpense };
}

interface ActiveShare {
  participantId: string;
  participantName: string;
  shareBps: number;
}

/**
 * Доли, действующие в месяце: живые (не архивные) участники, у которых есть доля,
 * покрывающая месяц. Архивный участник в распределение месяца не попадает — если
 * его доля не закрыта, сумма долей не сойдётся к 100% и закрытие месяца это поймает.
 */
async function activeSharesForMonth(
  db: Prisma.TransactionClient | Runtime["prisma"],
  month: Month,
): Promise<ActiveShare[]> {
  const participants = await db.financeParticipant.findMany({
    where: { archivedAt: null },
    include: { shares: true },
    // Стабильный порядок → детерминированный тай-брейк лишнего рубля при
    // равных дробных остатках и долях (важно для повторяемости reopen→re-close).
    orderBy: { id: "asc" },
  });
  const active: ActiveShare[] = [];
  for (const p of participants) {
    const share = p.shares.find((s) =>
      shareActiveInMonth(
        { startMonth: dateToMonth(s.startMonth), endMonth: s.endMonth ? dateToMonth(s.endMonth) : null },
        month,
      ),
    );
    if (share) {
      active.push({ participantId: p.id, participantName: p.name, shareBps: share.shareBps });
    }
  }
  return active;
}

function previewAllocations(net: number, shares: ActiveShare[]): FinanceAllocation[] {
  return allocateByShares(net, shares).map((s) => ({
    participantId: s.participantId,
    participantName: s.participantName,
    shareBps: s.shareBps,
    amount: s.amount,
  }));
}

/**
 * Распределение месяца: закрытое — из снимка (`FinanceAllocation`); открытое —
 * рассчитывается на лету по текущим поступлениям/расходам и активным долям.
 */
export async function getDistribution(
  rt: Runtime,
  month: Month,
): Promise<FinanceDistribution> {
  const row = await rt.prisma.financeDistribution.findUnique({
    where: { periodMonth: monthToDate(month) },
    include: { allocations: { orderBy: { amount: "desc" } } },
  });

  if (row && row.status === "closed") {
    // Снимок заморожен при закрытии; сверяем с живым итогом, чтобы поймать правки
    // поступлений/расходов месяца, сделанные уже после закрытия.
    const live = await monthTotals(rt.prisma, month);
    const stale =
      live.totalIncome !== row.totalIncome || live.totalExpense !== row.totalExpense;
    return {
      month,
      status: "closed",
      totalIncome: row.totalIncome,
      totalExpense: row.totalExpense,
      netIncome: row.netIncome,
      shareBpsTotal: row.allocations.reduce((a, x) => a + x.shareBps, 0),
      allocations: row.allocations.map((a) => ({
        participantId: a.participantId,
        participantName: a.participantName,
        shareBps: a.shareBps,
        amount: a.amount,
      })),
      stale,
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  const totals = await monthTotals(rt.prisma, month);
  const shares = await activeSharesForMonth(rt.prisma, month);
  return {
    month,
    status: "open",
    ...totals,
    shareBpsTotal: shares.reduce((a, s) => a + s.shareBps, 0),
    allocations: previewAllocations(totals.netIncome, shares),
    stale: false,
    closedAt: null,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

/** Список распределений за окно месяцев [from, to] (включительно). */
export async function listDistributions(
  rt: Runtime,
  from: Month,
  to: Month,
): Promise<FinanceDistribution[]> {
  const months = monthRange(from, to);
  const result: FinanceDistribution[] = [];
  for (const m of months) result.push(await getDistribution(rt, m));
  return result;
}

/**
 * Прогнать fn в serializable-транзакции. Конфликт сериализации (P2034) при
 * конкурентном close/reopen отдаём чистым 409, а не 500 — клиент повторит.
 */
async function inSerializableTx<T>(
  rt: Runtime,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await rt.prisma.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      throw new HttpError(409, "conflict", "Месяц одновременно меняют. Повторите попытку.");
    }
    throw e;
  }
}

/**
 * Закрыть месяц: зафиксировать снимок сумм и долей. Требует, чтобы доли активных
 * участников месяца в сумме давали ровно 100%. Идёт в serializable-транзакции,
 * чтобы параллельная правда (доли/суммы) не разъехалась со снимком.
 */
export async function closeDistribution(
  rt: Runtime,
  user: SessionUser,
  month: Month,
): Promise<FinanceDistribution> {
  const periodMonth = monthToDate(month);
  await inSerializableTx(rt, async (tx) => {
    const existing = await tx.financeDistribution.findUnique({
      where: { periodMonth },
    });
    if (existing?.status === "closed") {
      throw new HttpError(
        409,
        "already_closed",
        "Месяц уже закрыт. Переоткройте его для пересчёта.",
      );
    }
    const totals = await monthTotals(tx, month);
    const shares = await activeSharesForMonth(tx, month);
    if (shares.length === 0) {
      throw new HttpError(
        422,
        "no_participants",
        "Нет участников с долей на этот месяц.",
      );
    }
    const shareBpsTotal = shares.reduce((a, s) => a + s.shareBps, 0);
    if (shareBpsTotal !== FINANCE_TOTAL_BPS) {
      throw new HttpError(
        422,
        "shares_not_full",
        `Доли участников за месяц должны в сумме давать 100% (сейчас ${(shareBpsTotal / 100).toFixed(2)}%).`,
      );
    }
    const allocations = previewAllocations(totals.netIncome, shares);

    const dist = await tx.financeDistribution.upsert({
      where: { periodMonth },
      create: {
        periodMonth,
        status: "closed",
        totalIncome: totals.totalIncome,
        totalExpense: totals.totalExpense,
        netIncome: totals.netIncome,
        closedAt: new Date(),
        closedById: user.id,
      },
      update: {
        status: "closed",
        totalIncome: totals.totalIncome,
        totalExpense: totals.totalExpense,
        netIncome: totals.netIncome,
        closedAt: new Date(),
        closedById: user.id,
      },
    });
    await tx.financeAllocation.deleteMany({ where: { distributionId: dist.id } });
    await tx.financeAllocation.createMany({
      data: allocations.map((a) => ({
        distributionId: dist.id,
        participantId: a.participantId,
        participantName: a.participantName,
        shareBps: a.shareBps,
        amount: a.amount,
      })),
    });
  });
  return getDistribution(rt, month);
}

/**
 * Переоткрыть месяц: снять снимок долей, вернуть в статус «открыт». Чтение статуса
 * и правка идут в одной serializable-транзакции, чтобы не разъехаться с конкурентным
 * закрытием (которое тоже serializable).
 */
export async function reopenDistribution(
  rt: Runtime,
  month: Month,
): Promise<FinanceDistribution> {
  const periodMonth = monthToDate(month);
  await inSerializableTx(rt, async (tx) => {
    const existing = await tx.financeDistribution.findUnique({
      where: { periodMonth },
    });
    if (!existing || existing.status !== "closed") {
      throw new HttpError(422, "not_closed", "Месяц не закрыт.");
    }
    await tx.financeAllocation.deleteMany({ where: { distributionId: existing.id } });
    await tx.financeDistribution.update({
      where: { id: existing.id },
      data: { status: "open", closedAt: null, closedById: null },
    });
  });
  return getDistribution(rt, month);
}

// --- Сводка ---

export async function getSummary(
  rt: Runtime,
  from: Month,
  to: Month,
): Promise<FinanceSummary> {
  monthRange(from, to); // валидирует период (from ≤ to, ширина ≤ 60 мес.)
  const start = monthToDate(from);
  const end = monthToDate(nextMonth(to));

  const [incomeAgg, expenseConfirmedAgg, expenseDraftAgg] = await Promise.all([
    rt.prisma.financeIncome.aggregate({
      _sum: { amount: true },
      where: { date: { gte: start, lt: end } },
    }),
    rt.prisma.financeExpense.aggregate({
      _sum: { amount: true },
      where: { status: "confirmed", date: { gte: start, lt: end } },
    }),
    rt.prisma.financeExpense.aggregate({
      _sum: { amount: true },
      where: { status: "draft", date: { gte: start, lt: end } },
    }),
  ]);
  const totalIncome = incomeAgg._sum.amount ?? 0;
  const totalExpenseConfirmed = expenseConfirmedAgg._sum.amount ?? 0;
  const totalExpenseDraft = expenseDraftAgg._sum.amount ?? 0;
  const netIncome = totalIncome - totalExpenseConfirmed;

  // Закрытые распределения периода: разнесённый чистый доход + начисления.
  const closed = await rt.prisma.financeDistribution.findMany({
    where: { status: "closed", periodMonth: { gte: start, lt: end } },
    include: { allocations: true },
  });
  const distributedNet = closed.reduce((a, d) => a + d.netIncome, 0);
  const closedMonths = new Set(closed.map((d) => dateToMonth(d.periodMonth)));

  // Есть ли в периоде месяцы с активностью, но без закрытого распределения.
  const activityMonths = await monthsWithActivity(rt, start, end);
  const hasOpenMonths = [...activityMonths].some((m) => !closedMonths.has(m));

  // Балансы участников. Колонки «начислено/выплачено» — за период; «остаток к
  // выплате» — накопительно на конец периода (все начисления по закрытым месяцам
  // ≤ конца − все выплаты ≤ конца), чтобы число не зависело от начала окна.
  const allocatedByParticipant = new Map<string, number>();
  for (const d of closed) {
    for (const a of d.allocations) {
      allocatedByParticipant.set(
        a.participantId,
        (allocatedByParticipant.get(a.participantId) ?? 0) + a.amount,
      );
    }
  }
  const paidByParticipant = await payoutsByParticipantInRange(rt, from, to);
  const [cumAllocated, cumPaid] = await Promise.all([
    allocatedByParticipantBefore(rt, end),
    paidByParticipantBefore(rt, end),
  ]);

  const participantIds = new Set<string>([
    ...allocatedByParticipant.keys(),
    ...paidByParticipant.keys(),
    ...cumAllocated.keys(),
    ...cumPaid.keys(),
  ]);
  const participants = await rt.prisma.financeParticipant.findMany({
    where: { id: { in: [...participantIds] } },
  });
  const pMap = new Map(participants.map((p) => [p.id, p]));
  const balances: FinanceParticipantBalance[] = [...participantIds]
    .map((id) => {
      const allocated = allocatedByParticipant.get(id) ?? 0;
      const paidOut = paidByParticipant.get(id) ?? 0;
      const p = pMap.get(id);
      return {
        participantId: id,
        participantName: p?.name ?? "—",
        kind: (p?.kind ?? "other") as FinanceParticipantKind,
        allocated,
        paidOut,
        outstanding: (cumAllocated.get(id) ?? 0) - (cumPaid.get(id) ?? 0),
      };
    })
    // Прячем участников без активности за период и с нулевым остатком (шум).
    .filter((b) => b.allocated !== 0 || b.paidOut !== 0 || b.outstanding !== 0)
    .sort((a, b) => b.outstanding - a.outstanding);

  const constructions = await constructionPnl(rt, start, end);

  return {
    from,
    to,
    totalIncome,
    totalExpenseConfirmed,
    totalExpenseDraft,
    netIncome,
    distributedNet,
    hasOpenMonths,
    participants: balances,
    constructions,
  };
}

/**
 * Месяцы периода с денежной активностью: поступление или ПОДТВЕРЖДЁННЫЙ расход.
 * Черновики не считаем — их нечего разносить (в чистый доход не входят), иначе
 * месяц с одними черновиками ложно помечался бы как незакрытый.
 */
async function monthsWithActivity(
  rt: Runtime,
  start: Date,
  end: Date,
): Promise<Set<Month>> {
  const [incomes, expenses] = await Promise.all([
    rt.prisma.financeIncome.findMany({
      where: { date: { gte: start, lt: end } },
      select: { date: true },
    }),
    rt.prisma.financeExpense.findMany({
      where: { status: "confirmed", date: { gte: start, lt: end } },
      select: { date: true },
    }),
  ]);
  const months = new Set<Month>();
  for (const r of incomes) months.add(dateToMonth(r.date));
  for (const r of expenses) months.add(dateToMonth(r.date));
  return months;
}

/** Выплаты периода по участнику, отнесённые к месяцу (month ?? месяц даты). */
async function payoutsByParticipantInRange(
  rt: Runtime,
  from: Month,
  to: Month,
): Promise<Map<string, number>> {
  const start = monthToDate(from);
  const end = monthToDate(nextMonth(to));
  const payouts = await rt.prisma.financePayout.findMany({
    where: {
      OR: [
        { month: { gte: start, lt: end } },
        { month: null, date: { gte: start, lt: end } },
      ],
    },
    select: { participantId: true, amount: true },
  });
  const map = new Map<string, number>();
  for (const p of payouts) {
    map.set(p.participantId, (map.get(p.participantId) ?? 0) + p.amount);
  }
  return map;
}

/**
 * Начислено накопительно: сумма аллокаций по закрытым распределениям с
 * periodMonth < end, сгруппированная по участнику. (Аллокации существуют только
 * у закрытых месяцев — при переоткрытии снимок удаляется.)
 */
async function allocatedByParticipantBefore(
  rt: Runtime,
  end: Date,
): Promise<Map<string, number>> {
  const rows = await rt.prisma.financeAllocation.groupBy({
    by: ["participantId"],
    _sum: { amount: true },
    where: { distribution: { status: "closed", periodMonth: { lt: end } } },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.participantId, r._sum.amount ?? 0);
  return map;
}

/**
 * Выплачено накопительно: сумма выплат, отнесённых к месяцу < end (учётный
 * `month`, а при его отсутствии — `date`), по участнику.
 */
async function paidByParticipantBefore(
  rt: Runtime,
  end: Date,
): Promise<Map<string, number>> {
  const rows = await rt.prisma.financePayout.groupBy({
    by: ["participantId"],
    _sum: { amount: true },
    where: {
      OR: [{ month: { lt: end } }, { month: null, date: { lt: end } }],
    },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.participantId, r._sum.amount ?? 0);
  return map;
}

/** P&L по конструкции за период (поступления и подтверждённые расходы). */
async function constructionPnl(rt: Runtime, start: Date, end: Date) {
  const [incomeByC, expenseByC, constructions] = await Promise.all([
    rt.prisma.financeIncome.groupBy({
      by: ["constructionId"],
      _sum: { amount: true },
      where: { date: { gte: start, lt: end } },
    }),
    rt.prisma.financeExpense.groupBy({
      by: ["constructionId"],
      _sum: { amount: true },
      where: { status: "confirmed", date: { gte: start, lt: end } },
    }),
    rt.prisma.construction.findMany({ select: { id: true, name: true, code: true } }),
  ]);
  const cMap = new Map(constructions.map((c) => [c.id, c]));
  const ids = new Set<string | null>();
  const income = new Map<string | null, number>();
  const expense = new Map<string | null, number>();
  for (const r of incomeByC) {
    ids.add(r.constructionId);
    income.set(r.constructionId, r._sum.amount ?? 0);
  }
  for (const r of expenseByC) {
    ids.add(r.constructionId);
    expense.set(r.constructionId, r._sum.amount ?? 0);
  }
  return [...ids]
    .map((id) => {
      const c = id ? cMap.get(id) ?? null : null;
      const inc = income.get(id) ?? 0;
      const exp = expense.get(id) ?? 0;
      return {
        construction: c ? { id: c.id, name: c.name, code: c.code } : null,
        income: inc,
        expense: exp,
        net: inc - exp,
      };
    })
    .sort((a, b) => b.net - a.net);
}

// --- Хелперы окна месяцев ---

/** Список месяцев [from, to] включительно, с потолком окна. */
export function monthRange(from: Month, to: Month): Month[] {
  if (from > to) throw new HttpError(422, "bad_range", "Начало периода позже конца");
  const months: Month[] = [];
  let cur = from;
  while (cur <= to) {
    months.push(cur);
    if (months.length > MAX_MONTHS_WINDOW) {
      throw new HttpError(422, "range_too_wide", "Слишком широкий период (макс. 60 мес.)");
    }
    cur = nextMonth(cur);
  }
  return months;
}

/** Месяц по дате (для дефолтов периода). */
export function currentMonth(): Month {
  return monthOfDate(new Date().toISOString().slice(0, 10));
}
