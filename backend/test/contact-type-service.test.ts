import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  reorderContactTypes,
  restoreContactType,
} from "../src/contact-types/contact-type-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const liveTypes = [
  { id: "ct1", name: "Звонок", order: 1, archivedAt: null, createdAt: new Date() },
  { id: "ct2", name: "Встреча", order: 2, archivedAt: null, createdAt: new Date() },
];

describe("reorderContactTypes", () => {
  test("отклоняет неполный список id (422)", async () => {
    const prisma = { contactType: { findMany: async () => liveTypes } };
    await expect(
      reorderContactTypes(runtimeWith(prisma), { ids: ["ct1"] }),
    ).rejects.toMatchObject({ status: 422, code: "reorder_mismatch" });
  });

  test("отклоняет неизвестный id (422)", async () => {
    const prisma = { contactType: { findMany: async () => liveTypes } };
    await expect(
      reorderContactTypes(runtimeWith(prisma), { ids: ["ct1", "ghost"] }),
    ).rejects.toMatchObject({ status: 422, code: "reorder_mismatch" });
  });

  test("полный список — пишет новый порядок в транзакции", async () => {
    const updates: Array<{ id: string; order: number }> = [];
    const prisma = {
      contactType: {
        findMany: async () => liveTypes,
        update: ({ where, data }: any) => {
          updates.push({ id: where.id, order: data.order });
          return Promise.resolve();
        },
      },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    await reorderContactTypes(runtimeWith(prisma), { ids: ["ct2", "ct1"] });
    expect(updates).toEqual([
      { id: "ct2", order: 1 },
      { id: "ct1", order: 2 },
    ]);
  });
});

describe("restoreContactType", () => {
  test("возвращает тип в конец списка (order = last+1) и снимает архив", async () => {
    let updateArgs: any;
    const prisma = {
      contactType: {
        findUnique: async () => ({ id: "ct9", name: "X", order: 1, archivedAt: new Date() }),
        findFirst: async () => ({ id: "ct5", order: 7 }),
        update: async (args: any) => {
          updateArgs = args;
          return { id: "ct9", name: "X", order: 8, archivedAt: null };
        },
      },
    };
    const res = await restoreContactType(runtimeWith(prisma), "ct9");
    expect(updateArgs.data.order).toBe(8);
    expect(updateArgs.data.archivedAt).toBeNull();
    expect(res.isArchived).toBe(false);
  });
});
