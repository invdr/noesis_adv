import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import { assignmentNotifyChatId, getAgenda } from "../src/leads/lead-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const admin = { id: "admin", email: "a@gsk.ru", role: "admin" } as unknown as SessionUser;
const manager = { id: "m1", email: "m@gsk.ru", role: "manager" } as unknown as SessionUser;

const DAY = 24 * 60 * 60 * 1000;

/** Строка заявки для повестки (как её отдаёт findMany с include). */
function agendaRow(
  id: string,
  atMs: number | null,
  over: { type?: { name: string } | null } = {},
) {
  return {
    id,
    name: id,
    phone: "+79280000000",
    stage: { name: "В работе" },
    nextContactType: over.type === undefined ? { name: "Звонок" } : over.type,
    nextContactAt: atMs === null ? null : new Date(atMs),
  };
}

/** Мок prisma, запоминающий where из findMany. */
function agendaPrisma(rows: unknown[]) {
  const calls: { where: any } = { where: undefined };
  return {
    calls,
    prisma: {
      lead: {
        findMany: async ({ where }: any) => {
          calls.where = where;
          return rows;
        },
      },
    },
  };
}

describe("getAgenda — бакетинг по дню МСК", () => {
  test("раскладывает на просрочено / сегодня / ближайшие; дальше 7 дней — вне повестки", async () => {
    const now = Date.now();
    const rows = [
      agendaRow("overdue1", now - 2 * DAY),
      agendaRow("today1", now),
      agendaRow("up1", now + 2 * DAY),
      agendaRow("far1", now + 10 * DAY), // за пределами окна — исключается
    ];
    const { prisma } = agendaPrisma(rows);

    const res = await getAgenda(runtimeWith(prisma), manager, {});

    expect(res.overdue.map((i) => i.id)).toEqual(["overdue1"]);
    expect(res.today.map((i) => i.id)).toEqual(["today1"]);
    expect(res.upcoming.map((i) => i.id)).toEqual(["up1"]);
    // far1 не попал ни в одну группу.
    const all = [...res.overdue, ...res.today, ...res.upcoming, ...res.noTask].map(
      (i) => i.id,
    );
    expect(all).not.toContain("far1");
  });

  test("активная заявка без даты контакта → группа «без задачи»", async () => {
    const now = Date.now();
    const { calls, prisma } = agendaPrisma([
      agendaRow("today1", now),
      agendaRow("lost1", null),
    ]);

    const res = await getAgenda(runtimeWith(prisma), manager, {});

    expect(res.noTask.map((i) => i.id)).toEqual(["lost1"]);
    expect(res.noTask[0]!.nextContactAt).toBeNull();
    expect(res.today.map((i) => i.id)).toEqual(["today1"]);
    // Выборка больше не отсекает null-даты — иначе «без задачи» не собрать.
    expect(JSON.stringify(calls.where)).not.toContain("nextContactAt");
  });

  test("маппинг: этап и тип контакта; отсутствующий тип → null", async () => {
    const now = Date.now();
    const { prisma } = agendaPrisma([
      agendaRow("today1", now),
      agendaRow("today2", now, { type: null }),
    ]);

    const res = await getAgenda(runtimeWith(prisma), manager, {});

    expect(res.today[0]!.stageName).toBe("В работе");
    expect(res.today[0]!.nextContactTypeName).toBe("Звонок");
    expect(res.today[1]!.nextContactTypeName).toBeNull();
  });

  test("менеджер видит только свои заявки (assigneeId в where)", async () => {
    const { calls, prisma } = agendaPrisma([]);
    await getAgenda(runtimeWith(prisma), manager, {});
    expect(calls.where.AND[0]).toEqual({ assigneeId: "m1" });
  });

  test("admin по умолчанию видит всю команду (scope не задан → без assigneeId)", async () => {
    const { calls, prisma } = agendaPrisma([]);
    await getAgenda(runtimeWith(prisma), admin, {});
    expect(Object.keys(calls.where.AND[0])).toHaveLength(0);
  });

  test("admin со scope=mine ограничивается своими", async () => {
    const { calls, prisma } = agendaPrisma([]);
    await getAgenda(runtimeWith(prisma), admin, { scope: "mine" });
    expect(calls.where.AND[0]).toEqual({ assigneeId: "admin" });
  });
});

describe("assignmentNotifyChatId — выбор адресата уведомления", () => {
  const activeManager = (over: Partial<{ id: string; telegramChatId: string | null }> = {}) => ({
    id: over.id ?? "m2",
    role: "manager",
    isActive: true,
    telegramChatId: "telegramChatId" in over ? (over.telegramChatId ?? null) : "555",
  });

  test("менеджер с chat id, назначил другой пользователь → шлём", () => {
    expect(assignmentNotifyChatId(activeManager(), "admin")).toBe("555");
  });

  test("менеджер взял заявку сам (adressat === инициатор) → не шлём", () => {
    expect(assignmentNotifyChatId(activeManager({ id: "m2" }), "m2")).toBeNull();
  });

  test("менеджер без chat id → не шлём", () => {
    expect(assignmentNotifyChatId(activeManager({ telegramChatId: null }), "admin")).toBeNull();
  });

  test("заблокированный менеджер → не шлём", () => {
    expect(
      assignmentNotifyChatId({ id: "m2", role: "manager", isActive: false, telegramChatId: "555" }, "admin"),
    ).toBeNull();
  });

  test("не менеджер (admin) → не шлём", () => {
    expect(
      assignmentNotifyChatId({ id: "a2", role: "admin", isActive: true, telegramChatId: "555" }, "admin"),
    ).toBeNull();
  });

  test("нет ответственного (null) → не шлём", () => {
    expect(assignmentNotifyChatId(null, "admin")).toBeNull();
  });
});
