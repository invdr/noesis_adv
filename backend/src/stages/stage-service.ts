import type { Prisma, Stage as PrismaStage } from "@prisma/client";
import type {
  ArchiveStageInput,
  CreateStageInput,
  Stage,
  StageColor,
  StageKind,
  UpdateStageInput,
} from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { toStageDto } from "./stage-dto";

/** Только живые (неархивные) этапы. */
const liveWhere = { archivedAt: null };

/**
 * Список этапов по порядку. По умолчанию — только живые. Можно сузить до одной
 * воронки (`funnelId`). Без фильтра этапы идут сгруппированно по воронкам
 * (порядок воронки → порядок этапа внутри неё).
 */
export async function listStages(
  rt: Runtime,
  opts: { includeArchived?: boolean; funnelId?: string } = {},
): Promise<Stage[]> {
  const rows = await rt.prisma.stage.findMany({
    where: {
      ...(opts.includeArchived ? {} : liveWhere),
      ...(opts.funnelId ? { funnelId: opts.funnelId } : {}),
    },
    orderBy: [{ funnel: { order: "asc" } }, { order: "asc" }],
  });
  return rows.map(toStageDto);
}

/**
 * Id входного этапа воронки: заданной по `funnelId` (ручной приём в выбранную
 * воронку) либо воронки по умолчанию (публичные заявки с лендинга). Инвариант
 * гарантирует, что среди живых этапов воронки ровно один входной. Несуществующая/
 * архивная воронка — 422 (это пользовательский ввод), незасеянный вход — 500.
 */
export async function getEntryStageId(rt: Runtime, funnelId?: string): Promise<string> {
  const entry = await rt.prisma.stage.findFirst({
    where: {
      ...liveWhere,
      isEntry: true,
      funnel: funnelId
        ? { id: funnelId, archivedAt: null }
        : { isDefault: true, archivedAt: null },
    },
    orderBy: { order: "asc" },
  });
  if (!entry) {
    if (funnelId) {
      throw new HttpError(422, "invalid_funnel", "Воронка не найдена или в архиве");
    }
    throw new HttpError(500, "no_entry_stage", "Не настроен входной этап воронки");
  }
  return entry.id;
}

/** Цвет по умолчанию для нового этапа, если admin не выбрал свой. */
function defaultColorForKind(kind: StageKind): StageColor {
  if (kind === "won") return "green";
  if (kind === "lost") return "red";
  return "slate";
}

/**
 * Базовый валидный набор этапов для новой воронки (вход + успех + отказ) —
 * чтобы инварианты выполнялись с момента создания воронки.
 */
export function initialFunnelStages(funnelId: string): Prisma.StageCreateManyInput[] {
  return [
    { funnelId, name: "Новая", order: 1, kind: "in_progress", isEntry: true, color: "blue" },
    { funnelId, name: "Сделка", order: 2, kind: "won", color: "green" },
    { funnelId, name: "Отказ", order: 3, kind: "lost", color: "red" },
  ];
}

/** Создать этап — добавляется в конец указанной воронки. */
export async function createStage(
  rt: Runtime,
  input: CreateStageInput,
): Promise<Stage> {
  const funnel = await rt.prisma.funnel.findUnique({
    where: { id: input.funnelId },
  });
  if (!funnel || funnel.archivedAt) {
    throw new HttpError(422, "invalid_funnel", "Воронка не найдена");
  }
  const last = await rt.prisma.stage.findFirst({
    where: { ...liveWhere, funnelId: input.funnelId },
    orderBy: { order: "desc" },
  });
  const stage = await rt.prisma.stage.create({
    data: {
      funnelId: input.funnelId,
      name: input.name,
      kind: input.kind,
      color: input.color ?? defaultColorForKind(input.kind),
      order: (last?.order ?? 0) + 1,
    },
  });
  return toStageDto(stage);
}

/**
 * Обновить этап: имя, тип (`kind`), цвет и/или назначить входным. Проверяет
 * инварианты воронки этапа (≥1 won, ≥1 lost среди живых; ровно 1 входной —
 * флаг переносится).
 */
export async function updateStage(
  rt: Runtime,
  id: string,
  input: UpdateStageInput,
): Promise<Stage> {
  const stage = await requireStage(rt, id);
  if (stage.archivedAt) {
    throw new HttpError(409, "stage_archived", "Этап в архиве");
  }

  // Смена типа не должна оставить воронку без won или без lost.
  if (input.kind && input.kind !== stage.kind) {
    await assertKindChangeKeepsInvariant(rt, stage, input.kind);
  }

  return rt.prisma.$transaction(async (tx) => {
    // Назначение входного — снимаем флаг со всех прочих живых этапов этой воронки.
    if (input.isEntry) {
      await tx.stage.updateMany({
        where: { ...liveWhere, funnelId: stage.funnelId, id: { not: id } },
        data: { isEntry: false },
      });
    }
    const updated = await tx.stage.update({
      where: { id },
      data: {
        name: input.name,
        kind: input.kind,
        color: input.color,
        isEntry: input.isEntry ? true : undefined,
      },
    });
    return toStageDto(updated);
  });
}

/**
 * Переставить этапы внутри одной воронки — `ids` задаёт новый порядок. Все id
 * должны принадлежать одной воронке и составлять все её живые этапы.
 */
export async function reorderStages(
  rt: Runtime,
  ids: string[],
): Promise<Stage[]> {
  const stages = await rt.prisma.stage.findMany({ where: { id: { in: ids } } });
  if (stages.length !== ids.length) {
    throw new HttpError(422, "reorder_mismatch", "Некоторые этапы не найдены");
  }
  const funnelIds = new Set(stages.map((s) => s.funnelId));
  if (funnelIds.size !== 1) {
    throw new HttpError(
      422,
      "reorder_cross_funnel",
      "Переставлять можно только этапы одной воронки",
    );
  }
  const funnelId = stages[0]!.funnelId;
  const live = await rt.prisma.stage.findMany({
    where: { ...liveWhere, funnelId },
  });
  const liveIds = new Set(live.map((s) => s.id));
  if (ids.length !== live.length || !ids.every((id) => liveIds.has(id))) {
    throw new HttpError(
      422,
      "reorder_mismatch",
      "Список должен содержать все живые этапы воронки ровно по одному разу",
    );
  }
  await rt.prisma.$transaction(
    ids.map((id, index) =>
      rt.prisma.stage.update({ where: { id }, data: { order: index + 1 } }),
    ),
  );
  return listStages(rt, { funnelId });
}

/**
 * «Удаление» этапа = архивация с переносом его заявок в `targetStageId` (этап
 * той же воронки). Нельзя архивировать входной этап и последний живой won/lost
 * воронки. При переносе в терминальный этап требуется подтверждение.
 */
export async function archiveStage(
  rt: Runtime,
  id: string,
  input: ArchiveStageInput,
): Promise<Stage> {
  const stage = await requireStage(rt, id);
  if (stage.archivedAt) {
    throw new HttpError(409, "stage_archived", "Этап уже в архиве");
  }
  if (stage.isEntry) {
    throw new HttpError(
      409,
      "entry_stage",
      "Нельзя архивировать входной этап — сначала назначьте входным другой",
    );
  }
  await assertNotLastOfKind(rt, stage);

  if (input.targetStageId === id) {
    throw new HttpError(422, "invalid_target", "Целевой этап не может совпадать с архивируемым");
  }
  const target = await requireStage(rt, input.targetStageId);
  if (target.archivedAt) {
    throw new HttpError(422, "invalid_target", "Целевой этап в архиве");
  }
  if (target.funnelId !== stage.funnelId) {
    throw new HttpError(
      422,
      "invalid_target",
      "Переносить заявки можно только в этап той же воронки",
    );
  }

  // Перенос в терминальный этап закрывает заявки — требуем подтверждение.
  if (target.kind !== "in_progress" && !input.confirmTerminal) {
    const count = await rt.prisma.lead.count({ where: { stageId: id } });
    throw new HttpError(
      409,
      "confirm_terminal",
      `Заявки (${count}) будут перенесены в терминальный этап «${target.name}» и помечены закрытыми. Подтвердите перенос.`,
    );
  }

  const targetIsTerminal = target.kind !== "in_progress";
  return rt.prisma.$transaction(async (tx) => {
    // Переносим заявки этапа и фиксируем системные события истории.
    const moved = await tx.lead.findMany({
      where: { stageId: id },
      select: { id: true },
    });
    await tx.lead.updateMany({
      where: { stageId: id },
      data: {
        stageId: input.targetStageId,
        // Перенос в терминальный этап закрывает заявки — снимаем напоминание и тип.
        ...(targetIsTerminal ? { nextContactAt: null, nextContactTypeId: null } : {}),
      },
    });
    if (moved.length > 0) {
      await tx.leadStatusEvent.createMany({
        data: moved.map((lead) => ({
          leadId: lead.id,
          stageId: input.targetStageId,
          authorId: null,
        })),
      });
    }
    const archived = await tx.stage.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return toStageDto(archived);
  });
}

// --- внутреннее ---

async function requireStage(rt: Runtime, id: string): Promise<PrismaStage> {
  const stage = await rt.prisma.stage.findUnique({ where: { id } });
  if (!stage) throw new HttpError(404, "not_found", "Этап не найден");
  return stage;
}

/** Бросает, если архивация этапа оставит его воронку без won или без lost. */
async function assertNotLastOfKind(
  rt: Runtime,
  stage: PrismaStage,
): Promise<void> {
  if (stage.kind === "in_progress") return;
  const remaining = await rt.prisma.stage.count({
    where: {
      ...liveWhere,
      funnelId: stage.funnelId,
      kind: stage.kind,
      id: { not: stage.id },
    },
  });
  if (remaining === 0) {
    const label = stage.kind === "won" ? "успешного исхода" : "отказа";
    throw new HttpError(
      409,
      "last_of_kind",
      `Нельзя архивировать последний этап ${label} в воронке`,
    );
  }
}

/** Бросает, если смена типа этапа оставит его воронку без won или без lost. */
async function assertKindChangeKeepsInvariant(
  rt: Runtime,
  stage: PrismaStage,
  nextKind: StageKind,
): Promise<void> {
  if (stage.kind === "in_progress") return; // добавление won/lost не вредит
  const remaining = await rt.prisma.stage.count({
    where: {
      ...liveWhere,
      funnelId: stage.funnelId,
      kind: stage.kind,
      id: { not: stage.id },
    },
  });
  if (remaining === 0 && nextKind !== stage.kind) {
    const label = stage.kind === "won" ? "успешного исхода" : "отказа";
    throw new HttpError(
      409,
      "last_of_kind",
      `Нельзя сменить тип последнего этапа ${label} в воронке`,
    );
  }
}
