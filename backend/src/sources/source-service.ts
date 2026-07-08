import type {
  LeadSourceOption,
  ReorderLeadSourcesInput,
  UpsertLeadSourceInput,
} from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { toLeadSourceDto } from "./source-dto";

/**
 * Справочник источников заявок. Правила (см. контракт `source.ts`):
 * веб-источники лендинга (isWeb) заблокированы полностью — их id-слаги зашиты
 * в формы сайта; «Оффлайн»/«Прочее» (isSystem) можно переименовать, но не
 * удалить/архивировать (дефолты ручного приёма); кастомные — полный CRUD.
 */

/** Список источников по порядку. По умолчанию — только живые. */
export async function listLeadSources(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<LeadSourceOption[]> {
  const rows = await rt.prisma.leadSource.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toLeadSourceDto);
}

/** Создать источник (admin) — добавляется в конец списка. */
export async function createLeadSource(
  rt: Runtime,
  input: UpsertLeadSourceInput,
): Promise<LeadSourceOption> {
  const last = await rt.prisma.leadSource.findFirst({ orderBy: { order: "desc" } });
  const row = await rt.prisma.leadSource.create({
    data: { name: input.name, order: (last?.order ?? 0) + 1 },
  });
  return toLeadSourceDto(row);
}

/** Переименовать источник (admin). Веб-источники лендинга неизменяемы. */
export async function updateLeadSource(
  rt: Runtime,
  id: string,
  input: UpsertLeadSourceInput,
): Promise<LeadSourceOption> {
  const row = await requireSource(rt, id);
  if (row.isWeb) {
    throw new HttpError(
      422,
      "source_locked",
      "Веб-источник сайта нельзя переименовать: его идентификатор шлют формы лендинга",
    );
  }
  const updated = await rt.prisma.leadSource.update({
    where: { id },
    data: { name: input.name },
  });
  return toLeadSourceDto(updated);
}

/** Новый порядок источников (admin) — `ids` задаёт порядок всех живых строк. */
export async function reorderLeadSources(
  rt: Runtime,
  input: ReorderLeadSourcesInput,
): Promise<LeadSourceOption[]> {
  const { ids } = input;
  const live = await rt.prisma.leadSource.findMany({ where: { archivedAt: null } });
  const liveIds = new Set(live.map((s) => s.id));
  if (ids.length !== live.length || !ids.every((id) => liveIds.has(id))) {
    throw new HttpError(
      422,
      "reorder_mismatch",
      "Список должен содержать все живые источники ровно по одному разу",
    );
  }
  await rt.prisma.$transaction(
    ids.map((id, i) =>
      rt.prisma.leadSource.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );
  return listLeadSources(rt);
}

/** Архивировать источник (скрыть из выбора; заявки с ним сохраняются). */
export async function archiveLeadSource(rt: Runtime, id: string): Promise<LeadSourceOption> {
  const row = await requireSource(rt, id);
  if (row.isSystem) {
    throw new HttpError(
      422,
      "source_locked",
      "Встроенный источник нельзя архивировать",
    );
  }
  const updated = await rt.prisma.leadSource.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toLeadSourceDto(updated);
}

/** Восстановить источник из архива — в конец списка. */
export async function restoreLeadSource(rt: Runtime, id: string): Promise<LeadSourceOption> {
  await requireSource(rt, id);
  const last = await rt.prisma.leadSource.findFirst({ orderBy: { order: "desc" } });
  const updated = await rt.prisma.leadSource.update({
    where: { id },
    data: { archivedAt: null, order: (last?.order ?? 0) + 1 },
  });
  return toLeadSourceDto(updated);
}

/**
 * Удалить источник навсегда (admin). Встроенные не удаляются; используемый
 * заявками — тоже (409 → архив).
 */
export async function deleteLeadSource(rt: Runtime, id: string): Promise<void> {
  const row = await requireSource(rt, id);
  if (row.isSystem) {
    throw new HttpError(422, "source_locked", "Встроенный источник нельзя удалить");
  }
  const used = await rt.prisma.lead.count({ where: { source: id } });
  if (used > 0) {
    throw new HttpError(
      409,
      "source_in_use",
      `Источник используют заявки (${used}). Используйте архив.`,
    );
  }
  await rt.prisma.leadSource.delete({ where: { id } });
}

/**
 * Валидация источника при назначении заявке: существует и не в архиве.
 * `forbidWeb` — для ручного приёма (веб-слаги проставляет только лендинг).
 */
export async function requireAssignableSource(
  rt: Runtime,
  id: string,
  opts: { forbidWeb?: boolean } = {},
): Promise<void> {
  const row = await rt.prisma.leadSource.findUnique({ where: { id } });
  if (!row || row.archivedAt) {
    throw new HttpError(422, "invalid_source", "Источник не найден или в архиве");
  }
  if (opts.forbidWeb && row.isWeb) {
    throw new HttpError(
      422,
      "invalid_source",
      "Веб-источник сайта нельзя назначить вручную",
    );
  }
}

// --- внутреннее ---

async function requireSource(rt: Runtime, id: string) {
  const row = await rt.prisma.leadSource.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "not_found", "Источник не найден");
  return row;
}
