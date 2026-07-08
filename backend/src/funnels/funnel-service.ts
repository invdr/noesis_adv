import type {
  CreateFunnelInput,
  Funnel,
  UpdateFunnelInput,
} from "@noesis/contracts";
import type { Funnel as PrismaFunnel } from "@prisma/client";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { initialFunnelStages } from "../stages/stage-service";
import { toFunnelDto } from "./funnel-dto";

/** Только живые (неархивные) воронки. */
const liveWhere = { archivedAt: null };

/** Список живых воронок по порядку — с числом живых этапов в каждой. */
export async function listFunnels(rt: Runtime): Promise<Funnel[]> {
  const funnels = await rt.prisma.funnel.findMany({
    where: liveWhere,
    orderBy: { order: "asc" },
  });
  const counts = await rt.prisma.stage.groupBy({
    by: ["funnelId"],
    where: { archivedAt: null },
    _count: { _all: true },
  });
  const byFunnel = new Map(counts.map((c) => [c.funnelId, c._count._all]));
  return funnels.map((f) => toFunnelDto(f, byFunnel.get(f.id) ?? 0));
}

/**
 * Создать воронку: добавляется в конец списка и сразу получает минимальный
 * валидный набор этапов (вход / успех / отказ), чтобы инварианты выполнялись.
 * Новая воронка не становится воронкой по умолчанию.
 */
export async function createFunnel(
  rt: Runtime,
  input: CreateFunnelInput,
): Promise<Funnel> {
  const last = await rt.prisma.funnel.findFirst({
    where: liveWhere,
    orderBy: { order: "desc" },
  });
  const funnel = await rt.prisma.$transaction(async (tx) => {
    const created = await tx.funnel.create({
      data: { name: input.name, order: (last?.order ?? 0) + 1 },
    });
    await tx.stage.createMany({ data: initialFunnelStages(created.id) });
    return created;
  });
  return toFunnelDto(funnel, initialFunnelStages(funnel.id).length);
}

/**
 * Обновить воронку: переименование и/или назначение воронкой по умолчанию
 * (флаг переносится — снимается с прочих). Снять флаг напрямую нельзя.
 */
export async function updateFunnel(
  rt: Runtime,
  id: string,
  input: UpdateFunnelInput,
): Promise<Funnel> {
  const funnel = await requireFunnel(rt, id);
  if (funnel.archivedAt) {
    throw new HttpError(409, "funnel_archived", "Воронка в архиве");
  }
  const updated = await rt.prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.funnel.updateMany({
        where: { id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.funnel.update({
      where: { id },
      data: {
        name: input.name,
        isDefault: input.isDefault ? true : undefined,
      },
    });
  });
  return toFunnelDto(updated, await liveStageCount(rt, id));
}

/** Переставить воронки — `ids` задаёт новый порядок (все живые воронки). */
export async function reorderFunnels(
  rt: Runtime,
  ids: string[],
): Promise<Funnel[]> {
  const live = await rt.prisma.funnel.findMany({ where: liveWhere });
  const liveIds = new Set(live.map((f) => f.id));
  if (ids.length !== live.length || !ids.every((id) => liveIds.has(id))) {
    throw new HttpError(
      422,
      "reorder_mismatch",
      "Список должен содержать все живые воронки ровно по одному разу",
    );
  }
  await rt.prisma.$transaction(
    ids.map((id, index) =>
      rt.prisma.funnel.update({ where: { id }, data: { order: index + 1 } }),
    ),
  );
  return listFunnels(rt);
}

/**
 * Архивация воронки вместе с её этапами. Нельзя архивировать воронку по
 * умолчанию, последнюю живую воронку и воронку, в этапах которой есть заявки
 * (их сначала переносят в другую воронку).
 */
export async function archiveFunnel(rt: Runtime, id: string): Promise<Funnel> {
  const funnel = await requireFunnel(rt, id);
  if (funnel.archivedAt) {
    throw new HttpError(409, "funnel_archived", "Воронка уже в архиве");
  }
  if (funnel.isDefault) {
    throw new HttpError(
      409,
      "default_funnel",
      "Нельзя архивировать воронку по умолчанию — сначала назначьте другую",
    );
  }
  const otherLive = await rt.prisma.funnel.count({
    where: { ...liveWhere, id: { not: id } },
  });
  if (otherLive === 0) {
    throw new HttpError(409, "last_funnel", "Это последняя воронка");
  }
  const leadCount = await rt.prisma.lead.count({
    where: { stage: { funnelId: id } },
  });
  if (leadCount > 0) {
    throw new HttpError(
      409,
      "funnel_has_leads",
      `В воронке есть заявки (${leadCount}) — сначала переместите их в другую воронку`,
    );
  }

  const archived = await rt.prisma.$transaction(async (tx) => {
    await tx.stage.updateMany({
      where: { funnelId: id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return tx.funnel.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  });
  return toFunnelDto(archived, 0);
}

// --- внутреннее ---

async function requireFunnel(rt: Runtime, id: string): Promise<PrismaFunnel> {
  const funnel = await rt.prisma.funnel.findUnique({ where: { id } });
  if (!funnel) throw new HttpError(404, "not_found", "Воронка не найдена");
  return funnel;
}

function liveStageCount(rt: Runtime, funnelId: string): Promise<number> {
  return rt.prisma.stage.count({ where: { funnelId, archivedAt: null } });
}
