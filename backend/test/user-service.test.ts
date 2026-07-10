import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  createUserAccount,
  setUserActive,
  updateUser,
} from "../src/users/user-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const userRow = (over: Record<string, unknown> = {}) => ({
  id: "u2",
  email: "m@gsk.ru",
  role: "manager",
  isActive: true,
  mustChangePassword: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

describe("createUserAccount", () => {
  test("отклоняет занятый email до создания", async () => {
    const prisma = {
      user: { findUnique: async () => userRow() },
    };
    await expect(
      createUserAccount(runtimeWith(prisma), { email: "m@gsk.ru", role: "manager" }),
    ).rejects.toMatchObject({ status: 409, code: "email_taken" });
  });
});

describe("setUserActive (блокировка)", () => {
  test("нельзя заблокировать собственную учётку", async () => {
    const prisma = { user: { findUnique: async () => userRow({ id: "me" }) } };
    await expect(
      setUserActive(runtimeWith(prisma), "me", "me", false),
    ).rejects.toMatchObject({ status: 409, code: "self_block" });
  });

  test("нельзя заблокировать последнего активного админа", async () => {
    const prisma = {
      user: {
        findUnique: async () => userRow({ id: "a2", role: "admin" }),
        count: async () => 0, // других активных админов нет
      },
    };
    await expect(
      setUserActive(runtimeWith(prisma), "a1", "a2", false),
    ).rejects.toMatchObject({ status: 409, code: "last_admin" });
  });

  test("блокировка гасит сессии и возвращает активные заявки в очередь", async () => {
    const calls = { sessions: false, requeued: false };
    const prisma = {
      user: {
        findUnique: async () => userRow(),
        count: async () => 1, // есть другой активный админ
        update: async ({ data }: any) => userRow({ isActive: data.isActive }),
      },
      session: {
        deleteMany: async () => {
          calls.sessions = true;
          return { count: 1 };
        },
      },
      lead: {
        updateMany: async () => {
          calls.requeued = true;
          return { count: 3 };
        },
      },
      booking: { count: async () => 0 },
      $transaction: async (fn: any) => fn(prisma),
    };
    const result = await setUserActive(runtimeWith(prisma), "a1", "u2", false);
    expect(result.isActive).toBe(false);
    expect(result.activeLeadCount).toBe(0);
    expect(calls.sessions).toBe(true);
    expect(calls.requeued).toBe(true);
  });

  test("не блокирует получателя, пока его личное напоминание отправляется", async () => {
    let updated = false;
    const prisma = {
      user: {
        findUnique: async () => userRow(),
        count: async () => 1,
        update: async () => {
          updated = true;
          return userRow({ isActive: false });
        },
      },
      booking: { count: async () => 1 },
      $transaction: async (fn: any) => fn(prisma),
    };

    await expect(
      setUserActive(runtimeWith(prisma), "a1", "u2", false),
    ).rejects.toMatchObject({ status: 409, code: "reminder_delivery_in_progress" });
    expect(updated).toBe(false);
  });
});

describe("updateUser", () => {
  test("нельзя менять собственную роль", async () => {
    const prisma = {
      user: { findUnique: async () => userRow({ id: "me", role: "admin" }) },
    };
    await expect(
      updateUser(runtimeWith(prisma), "me", "me", { role: "manager" }),
    ).rejects.toMatchObject({ status: 409, code: "self_role" });
  });

  test("разжалование последнего админа запрещено", async () => {
    const prisma = {
      user: {
        findUnique: async () => userRow({ id: "a2", role: "admin" }),
        count: async () => 0,
      },
    };
    await expect(
      updateUser(runtimeWith(prisma), "a1", "a2", { role: "manager" }),
    ).rejects.toMatchObject({ status: 409, code: "last_admin" });
  });

  test("не меняет Telegram получателя, пока его личное напоминание отправляется", async () => {
    let updated = false;
    const prisma = {
      user: {
        findUnique: async () => userRow(),
        update: async () => {
          updated = true;
          return userRow({ telegramChatId: "new-chat" });
        },
      },
      booking: { count: async () => 1 },
      $transaction: async (fn: any) => fn(prisma),
    };

    await expect(
      updateUser(runtimeWith(prisma), "a1", "u2", { telegramChatId: "new-chat" }),
    ).rejects.toMatchObject({ status: 409, code: "reminder_delivery_in_progress" });
    expect(updated).toBe(false);
  });
});
