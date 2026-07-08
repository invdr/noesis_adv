import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  archiveLeadSource,
  deleteLeadSource,
  requireAssignableSource,
  updateLeadSource,
} from "../src/sources/source-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const webSource = { id: "hero_form", name: "Главная форма", isSystem: true, isWeb: true, archivedAt: null };
const systemSource = { id: "offline", name: "Оффлайн", isSystem: true, isWeb: false, archivedAt: null };
const customSource = { id: "src1", name: "Авито", isSystem: false, isWeb: false, archivedAt: null };

describe("справочник источников — инварианты системных строк", () => {
  test("веб-источник нельзя переименовать (id зашит в формы сайта)", async () => {
    const prisma = { leadSource: { findUnique: async () => webSource } };
    await expect(
      updateLeadSource(runtimeWith(prisma), "hero_form", { name: "Форма" }),
    ).rejects.toMatchObject({ status: 422, code: "source_locked" });
  });

  test("«Оффлайн» можно переименовать (системный, но не веб)", async () => {
    let updated: any;
    const prisma = {
      leadSource: {
        findUnique: async () => systemSource,
        update: async ({ data }: any) => {
          updated = data;
          return { ...systemSource, ...data };
        },
      },
    };
    const res = await updateLeadSource(runtimeWith(prisma), "offline", { name: "Офис" });
    expect(updated.name).toBe("Офис");
    expect(res.name).toBe("Офис");
  });

  test("встроенные нельзя архивировать и удалять", async () => {
    const prisma = { leadSource: { findUnique: async () => systemSource } };
    await expect(archiveLeadSource(runtimeWith(prisma), "offline")).rejects.toMatchObject({
      status: 422,
      code: "source_locked",
    });
    await expect(deleteLeadSource(runtimeWith(prisma), "offline")).rejects.toMatchObject({
      status: 422,
      code: "source_locked",
    });
  });

  test("кастомный источник с заявками не удаляется (409 → архив)", async () => {
    const prisma = {
      leadSource: { findUnique: async () => customSource },
      lead: { count: async () => 3 },
    };
    await expect(deleteLeadSource(runtimeWith(prisma), "src1")).rejects.toMatchObject({
      status: 409,
      code: "source_in_use",
    });
  });

  test("неиспользуемый кастомный источник удаляется", async () => {
    let deleted = false;
    const prisma = {
      leadSource: {
        findUnique: async () => customSource,
        delete: async () => {
          deleted = true;
          return customSource;
        },
      },
      lead: { count: async () => 0 },
    };
    await deleteLeadSource(runtimeWith(prisma), "src1");
    expect(deleted).toBe(true);
  });
});

describe("requireAssignableSource — валидация назначения источника заявке", () => {
  test("живой кастомный источник проходит", async () => {
    const prisma = { leadSource: { findUnique: async () => customSource } };
    await requireAssignableSource(runtimeWith(prisma), "src1", { forbidWeb: true });
  });

  test("архивный/несуществующий → 422 invalid_source", async () => {
    const archived = { ...customSource, archivedAt: new Date() };
    await expect(
      requireAssignableSource(runtimeWith({ leadSource: { findUnique: async () => archived } }), "src1"),
    ).rejects.toMatchObject({ status: 422, code: "invalid_source" });
    await expect(
      requireAssignableSource(runtimeWith({ leadSource: { findUnique: async () => null } }), "ghost"),
    ).rejects.toMatchObject({ status: 422, code: "invalid_source" });
  });

  test("веб-источник при ручном приёме отклоняется (forbidWeb)", async () => {
    const prisma = { leadSource: { findUnique: async () => webSource } };
    await expect(
      requireAssignableSource(runtimeWith(prisma), "hero_form", { forbidWeb: true }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_source" });
    // Без forbidWeb (правка канала в карточке) — веб разрешён.
    await requireAssignableSource(runtimeWith(prisma), "hero_form");
  });
});
