import { Prisma } from "@prisma/client";
import type {
  FinanceExpense,
  FinanceIncome,
  FinancePayout,
  ListFinanceExpenseQuery,
  ListFinanceIncomeQuery,
  ListFinancePayoutsQuery,
  SessionUser,
  UpsertFinanceExpenseInput,
  UpsertFinanceIncomeInput,
  UpsertFinancePayoutInput,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import {
  dateOnlyToDate,
  expenseInclude,
  incomeInclude,
  monthToDate,
  payoutInclude,
  toExpenseDto,
  toIncomeDto,
  toPayoutDto,
  type ExpenseRow,
  type IncomeRow,
  type PayoutRow,
} from "./finance-dto";

interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// --- Поступления ---

export async function listIncome(
  rt: Runtime,
  query: ListFinanceIncomeQuery,
): Promise<Paginated<FinanceIncome>> {
  const where: Prisma.FinanceIncomeWhereInput = {};
  if (query.from) where.date = { ...(where.date as object), gte: dateOnlyToDate(query.from) };
  if (query.to) where.date = { ...(where.date as object), lt: dateOnlyToDate(query.to) };
  if (query.constructionId) where.constructionId = query.constructionId;
  if (query.bookingId) where.bookingId = query.bookingId;

  const [rows, total] = await rt.prisma.$transaction([
    rt.prisma.financeIncome.findMany({
      where,
      include: incomeInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    rt.prisma.financeIncome.count({ where }),
  ]);
  return {
    items: (rows as IncomeRow[]).map(toIncomeDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function createIncome(
  rt: Runtime,
  user: SessionUser,
  input: UpsertFinanceIncomeInput,
): Promise<FinanceIncome> {
  const constructionId = await resolveIncomeLinks(rt, input);
  const row = await rt.prisma.financeIncome.create({
    data: {
      date: dateOnlyToDate(input.date),
      amount: input.amount,
      constructionId,
      bookingId: input.bookingId ?? null,
      comment: input.comment ?? null,
      createdById: user.id,
    },
    include: incomeInclude,
  });
  return toIncomeDto(row as IncomeRow);
}

export async function updateIncome(
  rt: Runtime,
  id: string,
  input: UpsertFinanceIncomeInput,
): Promise<FinanceIncome> {
  await requireIncome(rt, id);
  const constructionId = await resolveIncomeLinks(rt, input);
  const row = await rt.prisma.financeIncome.update({
    where: { id },
    data: {
      date: dateOnlyToDate(input.date),
      amount: input.amount,
      constructionId,
      bookingId: input.bookingId ?? null,
      comment: input.comment ?? null,
    },
    include: incomeInclude,
  });
  return toIncomeDto(row as IncomeRow);
}

export async function deleteIncome(rt: Runtime, id: string): Promise<void> {
  await requireIncome(rt, id);
  await rt.prisma.financeIncome.delete({ where: { id } });
}

/**
 * Проверяет существование брони/конструкции и подставляет конструкцию из брони,
 * если она не задана явно (поступление «с бронью и конструкцией»).
 */
async function resolveIncomeLinks(
  rt: Runtime,
  input: UpsertFinanceIncomeInput,
): Promise<string | null> {
  let constructionId = input.constructionId ?? null;
  if (input.bookingId) {
    const booking = await rt.prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: { constructionId: true },
    });
    if (!booking) throw new HttpError(422, "booking_not_found", "Бронь не найдена");
    if (!constructionId) constructionId = booking.constructionId;
  }
  if (constructionId) {
    const exists = await rt.prisma.construction.count({ where: { id: constructionId } });
    if (exists === 0) {
      throw new HttpError(422, "construction_not_found", "Конструкция не найдена");
    }
  }
  return constructionId;
}

async function requireIncome(rt: Runtime, id: string) {
  const row = await rt.prisma.financeIncome.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "not_found", "Поступление не найдено");
  return row;
}

// --- Расходы ---

export async function listExpenses(
  rt: Runtime,
  query: ListFinanceExpenseQuery,
): Promise<Paginated<FinanceExpense>> {
  const where: Prisma.FinanceExpenseWhereInput = {};
  if (query.from) where.date = { ...(where.date as object), gte: dateOnlyToDate(query.from) };
  if (query.to) where.date = { ...(where.date as object), lt: dateOnlyToDate(query.to) };
  if (query.status) where.status = query.status;
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.constructionId) where.constructionId = query.constructionId;

  const [rows, total] = await rt.prisma.$transaction([
    rt.prisma.financeExpense.findMany({
      where,
      include: expenseInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    rt.prisma.financeExpense.count({ where }),
  ]);
  return {
    items: (rows as ExpenseRow[]).map(toExpenseDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function createExpense(
  rt: Runtime,
  user: SessionUser,
  input: UpsertFinanceExpenseInput,
): Promise<FinanceExpense> {
  await validateExpenseLinks(rt, input);
  const row = await rt.prisma.financeExpense.create({
    data: {
      date: dateOnlyToDate(input.date),
      amount: input.amount,
      status: input.status,
      categoryId: input.categoryId,
      constructionId: input.constructionId ?? null,
      constructionSideId: input.constructionSideId ?? null,
      bookingId: input.bookingId ?? null,
      comment: input.comment ?? null,
      createdById: user.id,
    },
    include: expenseInclude,
  });
  return toExpenseDto(row as ExpenseRow);
}

export async function updateExpense(
  rt: Runtime,
  id: string,
  input: UpsertFinanceExpenseInput,
): Promise<FinanceExpense> {
  await requireExpense(rt, id);
  await validateExpenseLinks(rt, input);
  const row = await rt.prisma.financeExpense.update({
    where: { id },
    data: {
      date: dateOnlyToDate(input.date),
      amount: input.amount,
      status: input.status,
      categoryId: input.categoryId,
      constructionId: input.constructionId ?? null,
      constructionSideId: input.constructionSideId ?? null,
      bookingId: input.bookingId ?? null,
      comment: input.comment ?? null,
    },
    include: expenseInclude,
  });
  return toExpenseDto(row as ExpenseRow);
}

export async function deleteExpense(rt: Runtime, id: string): Promise<void> {
  await requireExpense(rt, id);
  await rt.prisma.financeExpense.delete({ where: { id } });
}

async function validateExpenseLinks(
  rt: Runtime,
  input: UpsertFinanceExpenseInput,
): Promise<void> {
  const category = await rt.prisma.financeExpenseCategory.findUnique({
    where: { id: input.categoryId },
  });
  if (!category) throw new HttpError(422, "category_not_found", "Статья не найдена");
  if (input.bookingId) {
    const exists = await rt.prisma.booking.count({ where: { id: input.bookingId } });
    if (exists === 0) throw new HttpError(422, "booking_not_found", "Бронь не найдена");
  }
  if (input.constructionSideId) {
    const side = await rt.prisma.constructionSide.findUnique({
      where: { id: input.constructionSideId },
      select: { constructionId: true },
    });
    if (!side) throw new HttpError(422, "side_not_found", "Сторона не найдена");
    // Сторона задаёт свою конструкцию, если конструкция не выбрана явно.
    if (!input.constructionId) input.constructionId = side.constructionId;
    else if (input.constructionId !== side.constructionId) {
      throw new HttpError(
        422,
        "side_construction_mismatch",
        "Сторона относится к другой конструкции",
      );
    }
  }
  if (input.constructionId) {
    const exists = await rt.prisma.construction.count({
      where: { id: input.constructionId },
    });
    if (exists === 0) {
      throw new HttpError(422, "construction_not_found", "Конструкция не найдена");
    }
  }
}

async function requireExpense(rt: Runtime, id: string) {
  const row = await rt.prisma.financeExpense.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "not_found", "Расход не найден");
  return row;
}

// --- Выплаты ---

export async function listPayouts(
  rt: Runtime,
  query: ListFinancePayoutsQuery,
): Promise<Paginated<FinancePayout>> {
  const where: Prisma.FinancePayoutWhereInput = {};
  if (query.participantId) where.participantId = query.participantId;
  if (query.month) where.month = monthToDate(query.month);

  const [rows, total] = await rt.prisma.$transaction([
    rt.prisma.financePayout.findMany({
      where,
      include: payoutInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    rt.prisma.financePayout.count({ where }),
  ]);
  return {
    items: (rows as PayoutRow[]).map(toPayoutDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function createPayout(
  rt: Runtime,
  user: SessionUser,
  input: UpsertFinancePayoutInput,
): Promise<FinancePayout> {
  await requireActiveParticipant(rt, input.participantId);
  const row = await rt.prisma.financePayout.create({
    data: {
      participantId: input.participantId,
      date: dateOnlyToDate(input.date),
      amount: input.amount,
      month: input.month ? monthToDate(input.month) : null,
      comment: input.comment ?? null,
      createdById: user.id,
    },
    include: payoutInclude,
  });
  return toPayoutDto(row as PayoutRow);
}

export async function updatePayout(
  rt: Runtime,
  id: string,
  input: UpsertFinancePayoutInput,
): Promise<FinancePayout> {
  await requirePayout(rt, id);
  await requireActiveParticipant(rt, input.participantId);
  const row = await rt.prisma.financePayout.update({
    where: { id },
    data: {
      participantId: input.participantId,
      date: dateOnlyToDate(input.date),
      amount: input.amount,
      month: input.month ? monthToDate(input.month) : null,
      comment: input.comment ?? null,
    },
    include: payoutInclude,
  });
  return toPayoutDto(row as PayoutRow);
}

export async function deletePayout(rt: Runtime, id: string): Promise<void> {
  await requirePayout(rt, id);
  await rt.prisma.financePayout.delete({ where: { id } });
}

async function requireActiveParticipant(rt: Runtime, id: string) {
  const row = await rt.prisma.financeParticipant.findUnique({ where: { id } });
  if (!row) throw new HttpError(422, "participant_not_found", "Участник не найден");
  return row;
}

async function requirePayout(rt: Runtime, id: string) {
  const row = await rt.prisma.financePayout.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "not_found", "Выплата не найдена");
  return row;
}
