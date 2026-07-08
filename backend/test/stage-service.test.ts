import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  getEntryStageId,
  reorderStages,
  archiveStage,
} from "../src/stages/stage-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const stageRow = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "Этап",
  kind: "in_progress",
  funnelId: "f1",
  isEntry: false,
  order: 1,
  color: "slate",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

describe("getEntryStageId", () => {
  test("ищет входной этап именно живой дефолтной воронки", async () => {
    let seenWhere: any;
    const prisma = {
      stage: {
        findFirst: async ({ where }: any) => {
          seenWhere = where;
          return stageRow({ id: "entry", isEntry: true });
        },
      },
    };
    expect(await getEntryStageId(runtimeWith(prisma))).toBe("entry");
    // Запрос должен скоупиться: живой входной этап + дефолтная живая воронка.
    expect(seenWhere.isEntry).toBe(true);
    expect(seenWhere.archivedAt).toBeNull();
    expect(seenWhere.funnel).toMatchObject({ isDefault: true, archivedAt: null });
  });

  test("бросает 500, если входной этап не настроен", async () => {
    const prisma = { stage: { findFirst: async () => null } };
    await expect(getEntryStageId(runtimeWith(prisma))).rejects.toMatchObject({
      status: 500,
      code: "no_entry_stage",
    });
  });
});

describe("reorderStages", () => {
  test("отклоняет этапы из разных воронок (422)", async () => {
    const prisma = {
      stage: {
        findMany: async () => [
          stageRow({ id: "a", funnelId: "f1" }),
          stageRow({ id: "b", funnelId: "f2" }),
        ],
      },
    };
    await expect(
      reorderStages(runtimeWith(prisma), ["a", "b"]),
    ).rejects.toMatchObject({ status: 422, code: "reorder_cross_funnel" });
  });

  test("отклоняет неполный список живых этапов воронки (422)", async () => {
    let call = 0;
    const prisma = {
      stage: {
        findMany: async () => {
          call += 1;
          // 1-й вызов — выборка по ids; 2-й — все живые этапы воронки.
          return call === 1
            ? [stageRow({ id: "a", funnelId: "f1" })]
            : [stageRow({ id: "a", funnelId: "f1" }), stageRow({ id: "b", funnelId: "f1" })];
        },
      },
    };
    await expect(
      reorderStages(runtimeWith(prisma), ["a"]),
    ).rejects.toMatchObject({ status: 422, code: "reorder_mismatch" });
  });

  test("полный список — пишет новый порядок в транзакции", async () => {
    const updates: Array<{ id: string; order: number }> = [];
    const live = [
      stageRow({ id: "a", funnelId: "f1" }),
      stageRow({ id: "b", funnelId: "f1" }),
    ];
    const prisma = {
      stage: {
        findMany: async () => live,
        update: ({ where, data }: any) => {
          updates.push({ id: where.id, order: data.order });
          return Promise.resolve();
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    await reorderStages(runtimeWith(prisma), ["b", "a"]);
    expect(updates).toEqual([
      { id: "b", order: 1 },
      { id: "a", order: 2 },
    ]);
  });
});

describe("archiveStage", () => {
  test("отклоняет перенос заявок в этап другой воронки (422)", async () => {
    const source = stageRow({ id: "s1", funnelId: "f1", kind: "in_progress" });
    const target = stageRow({ id: "t1", funnelId: "f2", kind: "in_progress" });
    const prisma = {
      stage: {
        findUnique: async ({ where }: any) => (where.id === "s1" ? source : target),
      },
    };
    await expect(
      archiveStage(runtimeWith(prisma), "s1", { targetStageId: "t1" }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_target" });
  });
});
