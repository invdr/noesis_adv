import { z } from "zod";
import { paginationQuerySchema } from "./common";
import { dateOnlySchema } from "./booking";

// --- Общие примитивы ---

/** 100% доли = 10 000 базисных пунктов (bps). Позволяет дробные проценты без float. */
export const FINANCE_TOTAL_BPS = 10000;

/** Месяц периода в формате ГГГГ-ММ (например, 2026-07). */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Месяц в формате ГГГГ-ММ");
export type Month = z.infer<typeof monthSchema>;

/** Доля в процентах: bps как целое 1..10000; в UI показываем как %. */
export const shareBpsSchema = z
  .number()
  .int()
  .min(1, "Доля должна быть больше 0")
  .max(FINANCE_TOTAL_BPS, "Доля не может превышать 100%");

/** Сумма денег в рублях (целое, неотрицательное — для поступлений/расходов/выплат). */
const positiveAmountSchema = z
  .number()
  .int()
  .positive("Сумма должна быть больше 0");

// --- Статьи расходов (справочник, admin) ---

export const financeExpenseCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  isArchived: z.boolean(),
});
export type FinanceExpenseCategory = z.infer<
  typeof financeExpenseCategorySchema
>;

export const upsertFinanceExpenseCategorySchema = z.object({
  name: z.string().trim().min(1, "Укажите статью").max(80),
});
export type UpsertFinanceExpenseCategoryInput = z.infer<
  typeof upsertFinanceExpenseCategorySchema
>;

export const reorderFinanceExpenseCategoriesSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type ReorderFinanceExpenseCategoriesInput = z.infer<
  typeof reorderFinanceExpenseCategoriesSchema
>;

// --- Участники распределения ---

export const financeParticipantKindSchema = z.enum([
  "owner",
  "investor",
  "other",
]);
export type FinanceParticipantKind = z.infer<
  typeof financeParticipantKindSchema
>;

export const FINANCE_PARTICIPANT_KIND_LABEL: Record<
  FinanceParticipantKind,
  string
> = {
  owner: "Владелец",
  investor: "Инвестор",
  other: "Участник",
};

/**
 * Доля участника, действующая на интервале месяцев [startMonth, endMonth).
 * `endMonth = null` — доля открыта (действует бессрочно). Доли одного участника
 * не пересекаются по месяцам.
 */
export const financeShareSchema = z.object({
  id: z.string(),
  shareBps: shareBpsSchema,
  startMonth: monthSchema,
  endMonth: monthSchema.nullable(),
});
export type FinanceShare = z.infer<typeof financeShareSchema>;

export const financeParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: financeParticipantKindSchema,
  note: z.string().nullable(),
  isArchived: z.boolean(),
  /** Таймлайн долей, отсортирован по возрастанию `startMonth`. */
  shares: z.array(financeShareSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FinanceParticipant = z.infer<typeof financeParticipantSchema>;

const upsertShareSchema = z
  .object({
    shareBps: shareBpsSchema,
    startMonth: monthSchema,
    endMonth: monthSchema.nullable().optional(),
  })
  .refine(
    (v) => v.endMonth == null || v.startMonth < v.endMonth,
    { path: ["endMonth"], message: "Конец периода должен быть позже начала" },
  );

export const upsertFinanceParticipantSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите имя участника").max(120),
    kind: financeParticipantKindSchema,
    note: z.string().trim().max(500).nullable().optional(),
    shares: z.array(upsertShareSchema).max(60).default([]),
  })
  .superRefine((v, ctx) => {
    // Доли одного участника не должны пересекаться по месяцам.
    const sorted = [...v.shares].sort((a, b) =>
      a.startMonth < b.startMonth ? -1 : a.startMonth > b.startMonth ? 1 : 0,
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const prevEnd = prev.endMonth ?? null;
      if (prevEnd == null || cur.startMonth < prevEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["shares"],
          message: "Периоды долей не должны пересекаться",
        });
        break;
      }
    }
  });
export type UpsertFinanceParticipantInput = z.infer<
  typeof upsertFinanceParticipantSchema
>;

// --- Ссылки на конструкцию/сторону/бронь (краткие сводки для DTO) ---

const FINANCE_CONSTRUCTION_REF = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
});

const FINANCE_BOOKING_REF = z.object({
  id: z.string(),
  sideCode: z.string().nullable(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
});

// --- Фактические поступления ---

export const financeIncomeSchema = z.object({
  id: z.string(),
  date: dateOnlySchema,
  amount: z.number().int(),
  construction: FINANCE_CONSTRUCTION_REF.nullable(),
  booking: FINANCE_BOOKING_REF.nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FinanceIncome = z.infer<typeof financeIncomeSchema>;

export const upsertFinanceIncomeSchema = z.object({
  date: dateOnlySchema,
  amount: positiveAmountSchema,
  constructionId: z.string().min(1).nullable().optional(),
  bookingId: z.string().min(1).nullable().optional(),
  comment: z.string().trim().max(500).nullable().optional(),
});
export type UpsertFinanceIncomeInput = z.infer<
  typeof upsertFinanceIncomeSchema
>;

export const listFinanceIncomeQuerySchema = paginationQuerySchema.extend({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  constructionId: z.string().optional(),
  bookingId: z.string().optional(),
});
export type ListFinanceIncomeQuery = z.infer<
  typeof listFinanceIncomeQuerySchema
>;

// --- Расходы ---

export const financeExpenseStatusSchema = z.enum(["draft", "confirmed"]);
export type FinanceExpenseStatus = z.infer<typeof financeExpenseStatusSchema>;

export const FINANCE_EXPENSE_STATUS_LABEL: Record<
  FinanceExpenseStatus,
  string
> = {
  draft: "Черновик",
  confirmed: "Подтверждён",
};

export const financeExpenseSchema = z.object({
  id: z.string(),
  date: dateOnlySchema,
  amount: z.number().int(),
  status: financeExpenseStatusSchema,
  category: financeExpenseCategorySchema,
  construction: FINANCE_CONSTRUCTION_REF.nullable(),
  booking: FINANCE_BOOKING_REF.nullable(),
  sideCode: z.string().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FinanceExpense = z.infer<typeof financeExpenseSchema>;

export const upsertFinanceExpenseSchema = z.object({
  date: dateOnlySchema,
  amount: positiveAmountSchema,
  categoryId: z.string().min(1, "Выберите статью"),
  status: financeExpenseStatusSchema.default("draft"),
  constructionId: z.string().min(1).nullable().optional(),
  constructionSideId: z.string().min(1).nullable().optional(),
  bookingId: z.string().min(1).nullable().optional(),
  comment: z.string().trim().max(500).nullable().optional(),
});
export type UpsertFinanceExpenseInput = z.infer<
  typeof upsertFinanceExpenseSchema
>;

export const listFinanceExpenseQuerySchema = paginationQuerySchema.extend({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  status: financeExpenseStatusSchema.optional(),
  categoryId: z.string().optional(),
  constructionId: z.string().optional(),
});
export type ListFinanceExpenseQuery = z.infer<
  typeof listFinanceExpenseQuerySchema
>;

// --- Помесячное распределение ---

export const financeDistributionStatusSchema = z.enum(["open", "closed"]);
export type FinanceDistributionStatus = z.infer<
  typeof financeDistributionStatusSchema
>;

/** Строка распределения на участника (снимок при закрытии либо превью). */
export const financeAllocationSchema = z.object({
  participantId: z.string(),
  participantName: z.string(),
  shareBps: z.number().int(),
  amount: z.number().int(),
});
export type FinanceAllocation = z.infer<typeof financeAllocationSchema>;

export const financeDistributionSchema = z.object({
  month: monthSchema,
  status: financeDistributionStatusSchema,
  totalIncome: z.number().int(),
  totalExpense: z.number().int(),
  netIncome: z.number().int(),
  /** Сумма долей активных участников месяца (bps). Для закрытия должна быть 10000. */
  shareBpsTotal: z.number().int(),
  allocations: z.array(financeAllocationSchema),
  closedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type FinanceDistribution = z.infer<typeof financeDistributionSchema>;

export const listFinanceDistributionsQuerySchema = z.object({
  from: monthSchema.optional(),
  to: monthSchema.optional(),
});
export type ListFinanceDistributionsQuery = z.infer<
  typeof listFinanceDistributionsQuerySchema
>;

// --- Выплаты участникам ---

export const financePayoutSchema = z.object({
  id: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  month: monthSchema.nullable(),
  date: dateOnlySchema,
  amount: z.number().int(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FinancePayout = z.infer<typeof financePayoutSchema>;

export const upsertFinancePayoutSchema = z.object({
  participantId: z.string().min(1, "Выберите участника"),
  month: monthSchema.nullable().optional(),
  date: dateOnlySchema,
  amount: positiveAmountSchema,
  comment: z.string().trim().max(500).nullable().optional(),
});
export type UpsertFinancePayoutInput = z.infer<
  typeof upsertFinancePayoutSchema
>;

export const listFinancePayoutsQuerySchema = paginationQuerySchema.extend({
  participantId: z.string().optional(),
  month: monthSchema.optional(),
});
export type ListFinancePayoutsQuery = z.infer<
  typeof listFinancePayoutsQuerySchema
>;

// --- Сводка (дашборд «Финансы») ---

/** Баланс участника: начислено/выплачено за период + накопительный остаток. */
export const financeParticipantBalanceSchema = z.object({
  participantId: z.string(),
  participantName: z.string(),
  kind: financeParticipantKindSchema,
  /** Начислено по закрытым распределениям за период (колонка «за период»). */
  allocated: z.number().int(),
  /** Выплачено за период (колонка «за период»). */
  paidOut: z.number().int(),
  /**
   * Остаток к выплате на конец периода — НАКОПИТЕЛЬНО: все начисления по закрытым
   * месяцам с periodMonth ≤ конца периода минус все выплаты, отнесённые к месяцу
   * ≤ конца периода. Не зависит от начала окна; может быть отрицательным при переплате.
   */
  outstanding: z.number().int(),
});
export type FinanceParticipantBalance = z.infer<
  typeof financeParticipantBalanceSchema
>;

/** P&L по конструкции за период. */
export const financeConstructionPnlSchema = z.object({
  construction: FINANCE_CONSTRUCTION_REF.nullable(),
  income: z.number().int(),
  expense: z.number().int(),
  net: z.number().int(),
});
export type FinanceConstructionPnl = z.infer<
  typeof financeConstructionPnlSchema
>;

export const financeSummarySchema = z.object({
  from: monthSchema,
  to: monthSchema,
  totalIncome: z.number().int(),
  /** Подтверждённые расходы (участвуют в чистом доходе). */
  totalExpenseConfirmed: z.number().int(),
  /** Расходы-черновики (справочно, не входят в чистый доход). */
  totalExpenseDraft: z.number().int(),
  netIncome: z.number().int(),
  /** Сколько чистого дохода уже разнесено закрытыми распределениями. */
  distributedNet: z.number().int(),
  /** Есть ли незакрытые месяцы в периоде (нужно закрыть для полного распределения). */
  hasOpenMonths: z.boolean(),
  participants: z.array(financeParticipantBalanceSchema),
  constructions: z.array(financeConstructionPnlSchema),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

export const financeSummaryQuerySchema = z.object({
  from: monthSchema,
  to: monthSchema,
});
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;

// --- Хелперы месяцев и распределения ---

/** Первый день месяца в формате dateOnly: 2026-07 → 2026-07-01. */
export function monthStart(month: Month): string {
  return `${month}-01`;
}

/** Месяц (ГГГГ-ММ) календарной даты YYYY-MM-DD. */
export function monthOfDate(dateOnly: string): Month {
  return dateOnly.slice(0, 7);
}

/** Следующий месяц: 2026-12 → 2027-01. */
export function nextMonth(month: Month): Month {
  const [y, m] = month.split("-").map(Number);
  const zero = (m! - 1) + 1;
  const year = y! + Math.floor(zero / 12);
  const mm = (zero % 12) + 1;
  return `${year}-${String(mm).padStart(2, "0")}`;
}

/** Активна ли доля в месяце: startMonth <= month < (endMonth ?? +inf). */
export function shareActiveInMonth(
  share: { startMonth: string; endMonth: string | null },
  month: Month,
): boolean {
  if (month < share.startMonth) return false;
  if (share.endMonth != null && month >= share.endMonth) return false;
  return true;
}

/**
 * Разложить целую сумму `net` по долям (bps) методом наибольшего остатка (Хэйра):
 * сумма выданных целых равна round(net × Σbps / 10000). При Σbps = 10000 сумма
 * равна ровно `net`. Корректно и для отрицательного `net` (убыток делится по долям).
 */
export function allocateByShares<T extends { shareBps: number }>(
  net: number,
  shares: T[],
): (T & { amount: number })[] {
  if (shares.length === 0) return [];
  const parts = shares.map((s) => {
    const exact = (net * s.shareBps) / FINANCE_TOTAL_BPS;
    const floor = Math.floor(exact);
    return { src: s, amount: floor, frac: exact - floor };
  });
  const sumBps = shares.reduce((a, s) => a + s.shareBps, 0);
  const target = Math.round((net * sumBps) / FINANCE_TOTAL_BPS);
  let diff = target - parts.reduce((a, p) => a + p.amount, 0);
  // diff ∈ [0, parts.length]: добираем по наибольшей дробной части.
  const order = [...parts].sort(
    (a, b) => b.frac - a.frac || b.src.shareBps - a.src.shareBps,
  );
  for (let i = 0; i < order.length && diff > 0; i++, diff--) {
    order[i]!.amount += 1;
  }
  return parts.map((p) => ({ ...p.src, amount: p.amount }));
}
