import type {
  FinanceExpenseCategory,
  FinanceParticipant,
  ReorderFinanceExpenseCategoriesInput,
  UpsertFinanceExpenseCategoryInput,
  UpsertFinanceParticipantInput,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import {
  monthToDate,
  participantInclude,
  toExpenseCategoryDto,
  toParticipantDto,
} from "./finance-dto";

// --- Статьи расходов ---

export async function listExpenseCategories(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<FinanceExpenseCategory[]> {
  const rows = await rt.prisma.financeExpenseCategory.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toExpenseCategoryDto);
}

export async function createExpenseCategory(
  rt: Runtime,
  input: UpsertFinanceExpenseCategoryInput,
): Promise<FinanceExpenseCategory> {
  const last = await rt.prisma.financeExpenseCategory.findFirst({
    orderBy: { order: "desc" },
  });
  const row = await rt.prisma.financeExpenseCategory.create({
    data: { name: input.name, order: (last?.order ?? 0) + 1 },
  });
  return toExpenseCategoryDto(row);
}

export async function updateExpenseCategory(
  rt: Runtime,
  id: string,
  input: UpsertFinanceExpenseCategoryInput,
): Promise<FinanceExpenseCategory> {
  await requireExpenseCategory(rt, id);
  const row = await rt.prisma.financeExpenseCategory.update({
    where: { id },
    data: { name: input.name },
  });
  return toExpenseCategoryDto(row);
}

export async function reorderExpenseCategories(
  rt: Runtime,
  input: ReorderFinanceExpenseCategoriesInput,
): Promise<FinanceExpenseCategory[]> {
  const live = await rt.prisma.financeExpenseCategory.findMany({
    where: { archivedAt: null },
  });
  const liveIds = new Set(live.map((c) => c.id));
  if (input.ids.length !== live.length || !input.ids.every((id) => liveIds.has(id))) {
    throw new HttpError(
      422,
      "reorder_mismatch",
      "Список должен содержать все живые статьи ровно по одному разу",
    );
  }
  await rt.prisma.$transaction(
    input.ids.map((id, i) =>
      rt.prisma.financeExpenseCategory.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );
  return listExpenseCategories(rt);
}

export async function archiveExpenseCategory(
  rt: Runtime,
  id: string,
): Promise<FinanceExpenseCategory> {
  await requireExpenseCategory(rt, id);
  const row = await rt.prisma.financeExpenseCategory.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toExpenseCategoryDto(row);
}

export async function restoreExpenseCategory(
  rt: Runtime,
  id: string,
): Promise<FinanceExpenseCategory> {
  await requireExpenseCategory(rt, id);
  const last = await rt.prisma.financeExpenseCategory.findFirst({
    orderBy: { order: "desc" },
  });
  const row = await rt.prisma.financeExpenseCategory.update({
    where: { id },
    data: { archivedAt: null, order: (last?.order ?? 0) + 1 },
  });
  return toExpenseCategoryDto(row);
}

export async function deleteExpenseCategory(rt: Runtime, id: string): Promise<void> {
  await requireExpenseCategory(rt, id);
  const used = await rt.prisma.financeExpense.count({ where: { categoryId: id } });
  if (used > 0) {
    throw new HttpError(
      409,
      "category_in_use",
      `Статью используют расходы (${used}). Используйте архив.`,
    );
  }
  await rt.prisma.financeExpenseCategory.delete({ where: { id } });
}

async function requireExpenseCategory(rt: Runtime, id: string) {
  const row = await rt.prisma.financeExpenseCategory.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "not_found", "Статья расходов не найдена");
  return row;
}

// --- Участники распределения ---

export async function listParticipants(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<FinanceParticipant[]> {
  const rows = await rt.prisma.financeParticipant.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    include: participantInclude,
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map(toParticipantDto);
}

export async function getParticipant(
  rt: Runtime,
  id: string,
): Promise<FinanceParticipant> {
  const row = await rt.prisma.financeParticipant.findUnique({
    where: { id },
    include: participantInclude,
  });
  if (!row) throw new HttpError(404, "not_found", "Участник не найден");
  return toParticipantDto(row);
}

export function createParticipant(
  rt: Runtime,
  input: UpsertFinanceParticipantInput,
): Promise<FinanceParticipant> {
  return saveParticipant(rt, input, null);
}

export function updateParticipant(
  rt: Runtime,
  id: string,
  input: UpsertFinanceParticipantInput,
): Promise<FinanceParticipant> {
  return saveParticipant(rt, input, id);
}

/** Создание/правка участника: доли переписываются таймлайном целиком. */
async function saveParticipant(
  rt: Runtime,
  input: UpsertFinanceParticipantInput,
  id: string | null,
): Promise<FinanceParticipant> {
  const shareData = input.shares.map((s) => ({
    shareBps: s.shareBps,
    startMonth: monthToDate(s.startMonth),
    endMonth: s.endMonth ? monthToDate(s.endMonth) : null,
  }));

  const saved = await rt.prisma.$transaction(async (tx) => {
    if (id) {
      const existing = await tx.financeParticipant.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, "not_found", "Участник не найден");
      await tx.financeParticipant.update({
        where: { id },
        data: { name: input.name, kind: input.kind, note: input.note ?? null },
      });
      await tx.financeShare.deleteMany({ where: { participantId: id } });
      if (shareData.length > 0) {
        await tx.financeShare.createMany({
          data: shareData.map((s) => ({ ...s, participantId: id })),
        });
      }
      return id;
    }
    const created = await tx.financeParticipant.create({
      data: {
        name: input.name,
        kind: input.kind,
        note: input.note ?? null,
        shares: { create: shareData },
      },
    });
    return created.id;
  });

  return getParticipant(rt, saved);
}

export async function archiveParticipant(
  rt: Runtime,
  id: string,
): Promise<FinanceParticipant> {
  await requireParticipant(rt, id);
  await rt.prisma.financeParticipant.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return getParticipant(rt, id);
}

export async function restoreParticipant(
  rt: Runtime,
  id: string,
): Promise<FinanceParticipant> {
  await requireParticipant(rt, id);
  await rt.prisma.financeParticipant.update({
    where: { id },
    data: { archivedAt: null },
  });
  return getParticipant(rt, id);
}

export async function deleteParticipant(rt: Runtime, id: string): Promise<void> {
  await requireParticipant(rt, id);
  const [allocations, payouts] = await Promise.all([
    rt.prisma.financeAllocation.count({ where: { participantId: id } }),
    rt.prisma.financePayout.count({ where: { participantId: id } }),
  ]);
  if (allocations > 0 || payouts > 0) {
    throw new HttpError(
      409,
      "participant_in_use",
      "У участника есть распределения или выплаты. Используйте архив.",
    );
  }
  await rt.prisma.financeParticipant.delete({ where: { id } });
}

async function requireParticipant(rt: Runtime, id: string) {
  const row = await rt.prisma.financeParticipant.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "not_found", "Участник не найден");
  return row;
}
