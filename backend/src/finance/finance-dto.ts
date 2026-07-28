import type {
  Booking as PrismaBooking,
  Construction as PrismaConstruction,
  ConstructionSide as PrismaConstructionSide,
  FinanceExpense as PrismaFinanceExpense,
  FinanceExpenseCategory as PrismaFinanceExpenseCategory,
  FinanceIncome as PrismaFinanceIncome,
  FinanceParticipant as PrismaFinanceParticipant,
  FinancePayout as PrismaFinancePayout,
  FinanceShare as PrismaFinanceShare,
} from "@prisma/client";
import type {
  ConstructionSide,
  FinanceExpense,
  FinanceExpenseCategory,
  FinanceExpenseStatus,
  FinanceIncome,
  FinanceParticipant,
  FinanceParticipantKind,
  FinancePayout,
} from "@noesis/contracts";

// --- Преобразование дат ---

/** YYYY-MM-DD → Date (UTC-полночь календарного дня). */
export function dateOnlyToDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/**
 * YYYY-MM-DD → Date полуночи СЛЕДУЮЩЕГО дня. Для включительной верхней границы
 * периода: `date < dateOnlyEndExclusive(to)` покрывает весь день `to`.
 */
export function dateOnlyEndExclusive(dateOnly: string): Date {
  return new Date(dateOnlyToDate(dateOnly).getTime() + 24 * 60 * 60 * 1000);
}

/** Date → YYYY-MM-DD. */
export function dateToDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** «ГГГГ-ММ» → Date (UTC-полночь первого дня месяца). */
export function monthToDate(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

/** Date → «ГГГГ-ММ». */
export function dateToMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

// --- Статьи расходов ---

export function toExpenseCategoryDto(
  row: PrismaFinanceExpenseCategory,
): FinanceExpenseCategory {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    isArchived: row.archivedAt !== null,
  };
}

// --- Участники и доли ---

export type ParticipantRow = PrismaFinanceParticipant & {
  shares: PrismaFinanceShare[];
};

export const participantInclude = { shares: true };

export function toParticipantDto(row: ParticipantRow): FinanceParticipant {
  const shares = [...row.shares]
    .sort((a, b) => a.startMonth.getTime() - b.startMonth.getTime())
    .map((s) => ({
      id: s.id,
      shareBps: s.shareBps,
      startMonth: dateToMonth(s.startMonth),
      endMonth: s.endMonth ? dateToMonth(s.endMonth) : null,
    }));
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as FinanceParticipantKind,
    note: row.note,
    isArchived: row.archivedAt !== null,
    shares,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- Ссылки на конструкцию/бронь ---

function constructionRef(c: PrismaConstruction | null) {
  return c ? { id: c.id, name: c.name, code: c.code } : null;
}

type BookingWithSide = PrismaBooking & { constructionSide: PrismaConstructionSide };

function bookingRef(b: BookingWithSide | null) {
  return b
    ? {
        id: b.id,
        // Prisma хранит код стороны строкой (валидирует Zod на записи),
        // поэтому наружу приводим к union контракта.
        sideCode: (b.constructionSide?.code as ConstructionSide | undefined) ?? null,
        startDate: dateToDateOnly(b.startDate),
        endDate: dateToDateOnly(b.endDate),
      }
    : null;
}

// --- Поступления ---

export type IncomeRow = PrismaFinanceIncome & {
  construction: PrismaConstruction | null;
  booking: BookingWithSide | null;
};

export const incomeInclude = {
  construction: true,
  booking: { include: { constructionSide: true } },
};

export function toIncomeDto(row: IncomeRow): FinanceIncome {
  return {
    id: row.id,
    date: dateToDateOnly(row.date),
    amount: row.amount,
    construction: constructionRef(row.construction),
    booking: bookingRef(row.booking),
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- Расходы ---

export type ExpenseRow = PrismaFinanceExpense & {
  category: PrismaFinanceExpenseCategory;
  construction: PrismaConstruction | null;
  constructionSide: PrismaConstructionSide | null;
  booking: BookingWithSide | null;
};

export const expenseInclude = {
  category: true,
  construction: true,
  constructionSide: true,
  booking: { include: { constructionSide: true } },
};

export function toExpenseDto(row: ExpenseRow): FinanceExpense {
  return {
    id: row.id,
    date: dateToDateOnly(row.date),
    amount: row.amount,
    status: row.status as FinanceExpenseStatus,
    category: toExpenseCategoryDto(row.category),
    construction: constructionRef(row.construction),
    booking: bookingRef(row.booking),
    constructionSideId: row.constructionSideId ?? null,
    sideCode: (row.constructionSide?.code as ConstructionSide | undefined) ?? null,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- Выплаты ---

export type PayoutRow = PrismaFinancePayout & {
  participant: PrismaFinanceParticipant;
};

export const payoutInclude = { participant: true };

export function toPayoutDto(row: PayoutRow): FinancePayout {
  return {
    id: row.id,
    participantId: row.participantId,
    participantName: row.participant.name,
    month: row.month ? dateToMonth(row.month) : null,
    date: dateToDateOnly(row.date),
    amount: row.amount,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
