import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SessionUser } from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import {
  getBookingReminders,
  sendDueBookingReminders,
} from "../src/bookings/booking-reminder-service";

const DAY = 24 * 60 * 60 * 1000;
const admin = { id: "admin", email: "a@n.ru", role: "admin" } as unknown as SessionUser;
const manager = { id: "m1", email: "m@n.ru", role: "manager" } as unknown as SessionUser;

function reminderRow(
  id: string,
  reminderAt: Date | null,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    kind: "commercial",
    status: "booked",
    campaignNote: null,
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-08-01T00:00:00.000Z"),
    reminderAt,
    construction: { name: "СФ-1", code: "СФ-1" },
    constructionSide: { code: "A" },
    client: { fullName: "ООО Ромашка" },
    brand: null,
    serviceReason: null,
    manager: { name: "Менеджер", email: "m@n.ru" },
    createdBy: { name: "Автор", email: "author@n.ru" },
    ...over,
  };
}

function runtimeWith(prisma: any, env: Record<string, unknown> = {}): Runtime {
  return { env, prisma } as unknown as Runtime;
}

describe("getBookingReminders", () => {
  test("раскладывает по дню МСК: просрочено / сегодня / ближайшие; дальше 7 дней — вне", async () => {
    const now = Date.now();
    const rows = [
      reminderRow("overdue", new Date(now - DAY)),
      reminderRow("today", new Date(now)),
      reminderRow("soon", new Date(now + 3 * DAY)),
      reminderRow("far", new Date(now + 30 * DAY)),
    ];
    const rt = runtimeWith({ booking: { findMany: async () => rows } });

    const res = await getBookingReminders(rt, admin, {});
    expect(res.overdue.map((i) => i.id)).toEqual(["overdue"]);
    expect(res.today.map((i) => i.id)).toEqual(["today"]);
    expect(res.upcoming.map((i) => i.id)).toEqual(["soon"]);
    const all = [...res.overdue, ...res.today, ...res.upcoming].map((i) => i.id);
    expect(all).not.toContain("far");
  });

  test("endDate инклюзивный, ответственный — менеджер (fallback создатель)", async () => {
    const rt = runtimeWith({
      booking: {
        findMany: async () => [
          reminderRow("a", new Date(), { manager: null }),
        ],
      },
    });
    const res = await getBookingReminders(rt, admin, {});
    const item = res.today[0]!;
    expect(item.endDate).toBe("2026-07-31"); // хранится 2026-08-01 (эксклюзивно)
    expect(item.managerName).toBe("Автор"); // менеджер не задан → создатель
  });

  test("менеджеру — только свои (ответственный или создатель), admin — вся команда", async () => {
    let capturedWhere: any;
    const prisma = {
      booking: {
        findMany: async ({ where }: any) => {
          capturedWhere = where;
          return [];
        },
      },
    };

    await getBookingReminders(runtimeWith(prisma), manager, {});
    const scope = capturedWhere.AND[0];
    expect(scope.OR).toEqual([
      { managerId: "m1" },
      { managerId: null, createdById: "m1" },
    ]);
    // статус-фильтр активных и наличие напоминания
    expect(capturedWhere.AND).toContainEqual({ reminderAt: { not: null } });
    expect(capturedWhere.AND).toContainEqual({ status: { in: ["booked", "onAir"] } });

    await getBookingReminders(runtimeWith(prisma), admin, {});
    expect(capturedWhere.AND[0]).toEqual({}); // admin по умолчанию — вся команда

    await getBookingReminders(runtimeWith(prisma), admin, { scope: "mine" });
    expect(capturedWhere.AND[0].OR).toBeDefined(); // admin scope=mine — свои
  });
});

describe("sendDueBookingReminders", () => {
  const realFetch = globalThis.fetch;
  let calls: any[];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function prismaWith(rows: any[]) {
    const marked: string[][] = [];
    return {
      marked,
      prisma: {
        booking: {
          findMany: async () => rows,
          updateMany: async ({ where }: any) => {
            marked.push(where.id.in);
            return { count: where.id.in.length };
          },
        },
      },
    };
  }

  test("без токена бота ничего не шлём и не помечаем", async () => {
    const rows = [
      reminderRow("a", new Date(), {
        manager: { isActive: true, telegramChatId: "100", name: "M", email: "m@n.ru" },
        createdBy: null,
      }),
    ];
    const { prisma, marked } = prismaWith(rows);
    const res = await sendDueBookingReminders(runtimeWith(prisma, {}));
    expect(res).toEqual({ candidates: 1, notified: 0, skipped: 1 });
    expect(calls).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });

  test("шлёт ответственному, помечает уведомлённой; fallback — создатель", async () => {
    const rows = [
      reminderRow("a", new Date(), {
        manager: { isActive: true, telegramChatId: "100", name: "M", email: "m@n.ru" },
        createdBy: null,
      }),
      reminderRow("b", new Date(), {
        manager: { isActive: true, telegramChatId: null, name: "M", email: "m@n.ru" },
        createdBy: { isActive: true, telegramChatId: "200", name: "A", email: "a@n.ru" },
      }),
    ];
    const { prisma, marked } = prismaWith(rows);
    const res = await sendDueBookingReminders(
      runtimeWith(prisma, { TELEGRAM_BOT_TOKEN: "T" }),
    );

    expect(res).toEqual({ candidates: 2, notified: 2, skipped: 0 });
    const chatIds = calls.map((c) => c.chat_id).sort();
    expect(chatIds).toEqual(["100", "200"]);
    expect(marked[0]!.sort()).toEqual(["a", "b"]);
  });

  test("без Telegram у адресата — пропускаем и не помечаем (уведомим позже)", async () => {
    const rows = [
      reminderRow("a", new Date(), {
        manager: { isActive: true, telegramChatId: null, name: "M", email: "m@n.ru" },
        createdBy: { isActive: true, telegramChatId: null, name: "A", email: "a@n.ru" },
      }),
    ];
    const { prisma, marked } = prismaWith(rows);
    const res = await sendDueBookingReminders(
      runtimeWith(prisma, { TELEGRAM_BOT_TOKEN: "T" }),
    );
    expect(res).toEqual({ candidates: 1, notified: 0, skipped: 1 });
    expect(calls).toHaveLength(0);
    expect(marked).toHaveLength(0);
  });
});
