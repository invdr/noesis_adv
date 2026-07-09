import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  createDeveloper,
  deleteDeveloper,
} from "../src/developers/developer-service";

function runtimeWith(prisma: any): Runtime {
  return { env: { FILES_PUBLIC_BASE: "/files" }, prisma } as unknown as Runtime;
}

describe("createDeveloper", () => {
  test("slug из имени, без логотипа", async () => {
    const prisma = {
      developer: {
        count: async () => 0,
        findFirst: async () => null,
        create: async ({ data }: any) => ({
          id: "d1",
          logo: null,
          archivedAt: null,
          createdAt: new Date(),
          ...data,
        }),
      },
    };
    const dev = await createDeveloper(runtimeWith(prisma), { name: "Лидер" }, undefined, "u1");
    expect(dev.slug).toBe("lider");
    expect(dev.isArchived).toBe(false);
    expect(dev.logo).toBeUndefined();
  });
});

describe("deleteDeveloper", () => {
  test("заблокировано, пока на владельца ссылаются конструкции", async () => {
    const prisma = {
      developer: { findUnique: async () => ({ id: "d1", logoId: null }) },
      construction: { count: async () => 2 },
    };
    await expect(deleteDeveloper(runtimeWith(prisma), "d1")).rejects.toMatchObject({
      status: 409,
    });
  });

  test("удаляет, когда ссылок нет", async () => {
    let deleted = false;
    const prisma = {
      developer: {
        findUnique: async () => ({ id: "d1", logoId: null }),
        delete: async () => {
          deleted = true;
        },
      },
      construction: { count: async () => 0 },
    };
    await deleteDeveloper(runtimeWith(prisma), "d1");
    expect(deleted).toBe(true);
  });
});
