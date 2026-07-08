import type {
  ContactType,
  ReorderContactTypesInput,
  UpsertContactTypeInput,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { toContactTypeDto } from "./contact-type-dto";

/** Список типов контакта по порядку. По умолчанию — только живые. */
export async function listContactTypes(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<ContactType[]> {
  const rows = await rt.prisma.contactType.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toContactTypeDto);
}

/** Создать тип контакта (admin) — добавляется в конец списка. */
export async function createContactType(
  rt: Runtime,
  input: UpsertContactTypeInput,
): Promise<ContactType> {
  const last = await rt.prisma.contactType.findFirst({ orderBy: { order: "desc" } });
  const ct = await rt.prisma.contactType.create({
    data: { name: input.name, order: (last?.order ?? 0) + 1 },
  });
  return toContactTypeDto(ct);
}

/** Переименовать тип контакта (admin). */
export async function updateContactType(
  rt: Runtime,
  id: string,
  input: UpsertContactTypeInput,
): Promise<ContactType> {
  await requireType(rt, id);
  const ct = await rt.prisma.contactType.update({
    where: { id },
    data: { name: input.name },
  });
  return toContactTypeDto(ct);
}

/** Новый порядок типов (admin) — `ids` задаёт порядок всех живых типов. */
export async function reorderContactTypes(
  rt: Runtime,
  input: ReorderContactTypesInput,
): Promise<ContactType[]> {
  const { ids } = input;
  const live = await rt.prisma.contactType.findMany({ where: { archivedAt: null } });
  const liveIds = new Set(live.map((t) => t.id));
  if (ids.length !== live.length || !ids.every((id) => liveIds.has(id))) {
    throw new HttpError(
      422,
      "reorder_mismatch",
      "Список должен содержать все живые типы контакта ровно по одному разу",
    );
  }
  await rt.prisma.$transaction(
    ids.map((id, i) =>
      rt.prisma.contactType.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );
  return listContactTypes(rt);
}

/** Архивировать тип (скрыть из выбора; заявки с ним сохраняются). */
export async function archiveContactType(rt: Runtime, id: string): Promise<ContactType> {
  await requireType(rt, id);
  const ct = await rt.prisma.contactType.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toContactTypeDto(ct);
}

/** Восстановить тип из архива — возвращаем в конец списка (детерминированный порядок). */
export async function restoreContactType(rt: Runtime, id: string): Promise<ContactType> {
  await requireType(rt, id);
  const last = await rt.prisma.contactType.findFirst({ orderBy: { order: "desc" } });
  const ct = await rt.prisma.contactType.update({
    where: { id },
    data: { archivedAt: null, order: (last?.order ?? 0) + 1 },
  });
  return toContactTypeDto(ct);
}

/**
 * Удалить тип навсегда (admin). Запрещено, если на него ссылается хотя бы одна
 * заявка — для таких используем архив (ссылки сохранятся).
 */
export async function deleteContactType(rt: Runtime, id: string): Promise<void> {
  await requireType(rt, id);
  const used = await rt.prisma.lead.count({ where: { nextContactTypeId: id } });
  if (used > 0) {
    throw new HttpError(
      409,
      "type_in_use",
      `Тип используют заявки (${used}). Используйте архив.`,
    );
  }
  await rt.prisma.contactType.delete({ where: { id } });
}

// --- внутреннее ---

async function requireType(rt: Runtime, id: string) {
  const ct = await rt.prisma.contactType.findUnique({ where: { id } });
  if (!ct) throw new HttpError(404, "not_found", "Тип контакта не найден");
  return ct;
}
