import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { UserRole } from "@noesis/contracts";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/auth-service";
import type { Runtime } from "../src/runtime";

const TOKEN = "finance-route-test-token";
const ORIGIN = "http://localhost:5173";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface Opts {
  income?: number;
  expense?: number;
  /** Замороженный снимок закрытого месяца, если отличается от живого итога. */
  snapshotIncome?: number;
  snapshotExpense?: number;
  participants?: { id: string; name: string; shares: { shareBps: number }[] }[];
  existingClosed?: boolean;
}

function runtimeWith(role: UserRole | null, opts: Opts = {}) {
  const state: {
    created: Record<string, unknown>[] | null;
    incomeWhere: Record<string, unknown> | null;
  } = { created: null, incomeWhere: null };
  const owner = new Date("2020-01-01T00:00:00.000Z");
  const participants = (opts.participants ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    kind: "owner",
    archivedAt: null,
    shares: p.shares.map((s) => ({ shareBps: s.shareBps, startMonth: owner, endMonth: null })),
  }));

  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        role && where.tokenHash === tokenHash(TOKEN)
          ? {
              id: `session-${role}`,
              userId: `user-${role}`,
              expiresAt: new Date(Date.now() + 60_000),
              lastSeenAt: new Date(),
              user: {
                id: `user-${role}`,
                email: `${role}@example.com`,
                name: null,
                role,
                mustChangePassword: false,
                isActive: true,
              },
            }
          : null,
      update: async () => ({}),
    },
    financeExpenseCategory: {
      findMany: async () => [],
    },
    financeIncome: {
      aggregate: async () => ({ _sum: { amount: opts.income ?? 0 } }),
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        state.incomeWhere = where ?? {};
        return [];
      },
      count: async () => 0,
    },
    financeExpense: {
      aggregate: async () => ({ _sum: { amount: opts.expense ?? 0 } }),
    },
    financeParticipant: {
      findMany: async () => participants,
    },
    financeAllocation: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        state.created = data;
        return { count: data.length };
      },
    },
    financeDistribution: {
      findUnique: async ({ include }: { include?: { allocations?: unknown } }) => {
        if (include?.allocations) {
          // Пост-транзакционное чтение getDistribution: закрытый снимок.
          const snapIncome = opts.snapshotIncome ?? opts.income ?? 0;
          const snapExpense = opts.snapshotExpense ?? opts.expense ?? 0;
          return {
            status: "closed",
            totalIncome: snapIncome,
            totalExpense: snapExpense,
            netIncome: snapIncome - snapExpense,
            closedAt: new Date(),
            updatedAt: new Date(),
            allocations: (state.created ?? []).map((a) => ({
              participantId: a.participantId,
              participantName: a.participantName,
              shareBps: a.shareBps,
              amount: a.amount,
            })),
          };
        }
        return opts.existingClosed ? { id: "dist1", status: "closed" } : null;
      },
      upsert: async () => ({ id: "dist1" }),
      update: async () => ({}),
    },
  };

  prisma.$transaction = async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[]);

  const rt = {
    env: { CORS_ORIGINS: [ORIGIN], COOKIE_SECURE: false, SESSION_TTL_HOURS: 12 },
    prisma,
  } as unknown as Runtime;
  return { rt, state };
}

function auth(): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE}=${TOKEN}`, Origin: ORIGIN };
}

/**
 * Рантайм для сводки: сценарий «начислено в январе, выплачено в феврале».
 * Окно Фев–Июл не содержит январского начисления, но остаток к выплате должен
 * оставаться накопительным (0), а не показывать мнимую переплату (−100000).
 */
function summaryRuntime(): Runtime {
  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === tokenHash(TOKEN)
          ? {
              id: "session-admin",
              userId: "user-admin",
              expiresAt: new Date(Date.now() + 60_000),
              lastSeenAt: new Date(),
              user: {
                id: "user-admin",
                email: "admin@example.com",
                name: null,
                role: "admin",
                mustChangePassword: false,
                isActive: true,
              },
            }
          : null,
      update: async () => ({}),
    },
    financeIncome: {
      aggregate: async () => ({ _sum: { amount: 0 } }),
      findMany: async () => [],
      groupBy: async () => [],
    },
    financeExpense: {
      aggregate: async () => ({ _sum: { amount: 0 } }),
      findMany: async () => [],
      groupBy: async () => [],
    },
    // В окне Фев–Июл закрытых распределений нет (январь вне окна).
    financeDistribution: { findMany: async () => [] },
    financePayout: {
      // За период: февральская выплата попадает в окно.
      findMany: async () => [{ participantId: "p1", amount: 100000 }],
      // Накопительно до конца периода: та же выплата.
      groupBy: async () => [{ participantId: "p1", _sum: { amount: 100000 } }],
    },
    // Накопительно: январское начисление (periodMonth ≤ конца окна).
    financeAllocation: {
      groupBy: async () => [{ participantId: "p1", _sum: { amount: 100000 } }],
    },
    financeParticipant: {
      findMany: async () => [{ id: "p1", name: "Я", kind: "owner", archivedAt: null }],
    },
    construction: { findMany: async () => [] },
  };
  prisma.$transaction = async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[]);
  return {
    env: { CORS_ORIGINS: [ORIGIN], COOKIE_SECURE: false, SESSION_TTL_HOURS: 12 },
    prisma,
  } as unknown as Runtime;
}

describe("financeRoutes — доступ", () => {
  test("без сессии — 401", async () => {
    const app = createApp(runtimeWith(null).rt);
    const res = await app.request("/api/finance/categories", { headers: { Origin: ORIGIN } });
    expect(res.status).toBe(401);
  });

  test("менеджеру запрещено — 403", async () => {
    const app = createApp(runtimeWith("manager").rt);
    const res = await app.request("/api/finance/categories", { headers: auth() });
    expect(res.status).toBe(403);
  });

  test("админу разрешено — 200", async () => {
    const app = createApp(runtimeWith("admin").rt);
    const res = await app.request("/api/finance/categories", { headers: auth() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("financeRoutes — фильтр периода", () => {
  test("верхняя граница 'to' включает граничный день", async () => {
    const { rt, state } = runtimeWith("admin");
    const res = await createApp(rt).request(
      "/api/finance/income?from=2026-07-01&to=2026-07-15",
      { headers: auth() },
    );
    expect(res.status).toBe(200);
    const date = (state.incomeWhere?.date ?? {}) as { gte?: Date; lt?: Date };
    // Нижняя граница включительна с полуночи 1 июля.
    expect(date.gte?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    // Верхняя — исключающая полночь 16 июля, т.е. весь день 15 июля попадает в выборку.
    expect(date.lt?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });
});

describe("financeRoutes — сводка, накопительный остаток", () => {
  test("остаток к выплате не зависит от начала окна (кросс-месячный сценарий)", async () => {
    const res = await createApp(summaryRuntime()).request(
      "/api/finance/summary?from=2026-02&to=2026-07",
      { headers: auth() },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const p = body.participants.find(
      (x: { participantId: string }) => x.participantId === "p1",
    );
    expect(p).toBeTruthy();
    // За период (Фев–Июл) начислений нет: январь вне окна.
    expect(p.allocated).toBe(0);
    // Выплата за период есть.
    expect(p.paidOut).toBe(100000);
    // Накопительно: 100000 начислено − 100000 выплачено = 0 (а не −100000).
    expect(p.outstanding).toBe(0);
  });
});

/**
 * Stateful-рантайм для жизненного цикла распределения: хранит статус и снимок,
 * чтобы прогнать reopen → open (превью) → re-close → closed (снимок).
 */
function lifecycleRuntime() {
  const state = {
    status: "closed" as "open" | "closed",
    allocations: [
      { participantId: "p1", participantName: "Я", shareBps: 10000, amount: 60000 },
    ] as Record<string, unknown>[],
  };
  const owner = new Date("2020-01-01T00:00:00.000Z");
  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === tokenHash(TOKEN)
          ? {
              id: "session-admin",
              userId: "user-admin",
              expiresAt: new Date(Date.now() + 60_000),
              lastSeenAt: new Date(),
              user: {
                id: "user-admin",
                email: "admin@example.com",
                name: null,
                role: "admin",
                mustChangePassword: false,
                isActive: true,
              },
            }
          : null,
      update: async () => ({}),
    },
    financeIncome: { aggregate: async () => ({ _sum: { amount: 100000 } }) },
    financeExpense: { aggregate: async () => ({ _sum: { amount: 40000 } }) },
    financeParticipant: {
      findMany: async () => [
        {
          id: "p1",
          name: "Я",
          kind: "owner",
          archivedAt: null,
          shares: [{ shareBps: 10000, startMonth: owner, endMonth: null }],
        },
      ],
    },
    financeAllocation: {
      deleteMany: async () => {
        state.allocations = [];
        return { count: 0 };
      },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        state.allocations = data;
        return { count: data.length };
      },
    },
    financeDistribution: {
      findUnique: async ({ include }: { include?: { allocations?: unknown } }) => {
        if (include?.allocations) {
          return state.status === "closed"
            ? {
                status: "closed",
                totalIncome: 100000,
                totalExpense: 40000,
                netIncome: 60000,
                closedAt: new Date(),
                updatedAt: new Date(),
                allocations: state.allocations,
              }
            : { status: "open", updatedAt: new Date() };
        }
        return { id: "dist1", status: state.status };
      },
      upsert: async () => {
        state.status = "closed";
        return { id: "dist1" };
      },
      update: async ({ data }: { data: { status?: "open" | "closed" } }) => {
        if (data.status) state.status = data.status;
        return {};
      },
    },
  };
  prisma.$transaction = async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[]);
  const rt = {
    env: { CORS_ORIGINS: [ORIGIN], COOKIE_SECURE: false, SESSION_TTL_HOURS: 12 },
    prisma,
  } as unknown as Runtime;
  return { rt, state };
}

describe("financeRoutes — устаревший снимок", () => {
  test("закрытый месяц с изменившимися данными помечается stale", async () => {
    const res = await createApp(
      runtimeWith("admin", {
        income: 150000, // живой итог после закрытия вырос
        expense: 40000,
        snapshotIncome: 100000, // снимок заморожен на моменте закрытия
        snapshotExpense: 40000,
        participants: [{ id: "p1", name: "Я", shares: [{ shareBps: 10000 }] }],
      }).rt,
    ).request("/api/finance/distributions/2026-07", { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("closed");
    expect(body.totalIncome).toBe(100000); // снимок заморожен
    expect(body.stale).toBe(true); // но живой итог разошёлся
  });

  test("закрытый месяц без изменений — не stale", async () => {
    const res = await createApp(
      runtimeWith("admin", {
        income: 100000,
        expense: 40000,
        participants: [{ id: "p1", name: "Я", shares: [{ shareBps: 10000 }] }],
      }).rt,
    ).request("/api/finance/distributions/2026-07", { headers: auth() });
    expect(res.status).toBe(200);
    expect((await res.json()).stale).toBe(false);
  });
});

describe("financeRoutes — переоткрытие месяца", () => {
  test("месяц не закрыт — 422", async () => {
    const res = await createApp(
      runtimeWith("admin", { existingClosed: false }).rt,
    ).request("/api/finance/distributions/2026-07/reopen", {
      method: "POST",
      headers: auth(),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("not_closed");
  });

  test("цикл reopen → open (превью) → re-close → тот же снимок", async () => {
    const { rt } = lifecycleRuntime();
    const app = createApp(rt);

    const reopened = await app.request("/api/finance/distributions/2026-07/reopen", {
      method: "POST",
      headers: auth(),
    });
    expect(reopened.status).toBe(200);
    const openBody = await reopened.json();
    expect(openBody.status).toBe("open");
    // Превью пересчитывается на лету из текущих сумм и долей.
    expect(openBody.allocations).toEqual([
      expect.objectContaining({ participantId: "p1", amount: 60000 }),
    ]);

    const reclosed = await app.request("/api/finance/distributions/2026-07/close", {
      method: "POST",
      headers: auth(),
    });
    expect(reclosed.status).toBe(200);
    const closedBody = await reclosed.json();
    expect(closedBody.status).toBe("closed");
    expect(closedBody.netIncome).toBe(60000);
    expect(closedBody.allocations).toEqual([
      expect.objectContaining({ participantId: "p1", amount: 60000 }),
    ]);
  });
});

/** Рантайм для проверки связей расхода: статья есть, бронь принадлежит конструкции cA. */
function expenseLinksRuntime(): Runtime {
  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === tokenHash(TOKEN)
          ? {
              id: "session-admin",
              userId: "user-admin",
              expiresAt: new Date(Date.now() + 60_000),
              lastSeenAt: new Date(),
              user: {
                id: "user-admin",
                email: "admin@example.com",
                name: null,
                role: "admin",
                mustChangePassword: false,
                isActive: true,
              },
            }
          : null,
      update: async () => ({}),
    },
    financeExpenseCategory: {
      findUnique: async () => ({ id: "cat1", name: "Аренда", order: 1, archivedAt: null }),
    },
    booking: {
      findUnique: async () => ({ constructionId: "cA" }),
    },
    construction: { count: async () => 1 },
  };
  return {
    env: { CORS_ORIGINS: [ORIGIN], COOKIE_SECURE: false, SESSION_TTL_HOURS: 12 },
    prisma,
  } as unknown as Runtime;
}

describe("financeRoutes — связи расхода", () => {
  test("бронь другой конструкции — 422 booking_construction_mismatch", async () => {
    const res = await createApp(expenseLinksRuntime()).request("/api/finance/expenses", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-07-10",
        amount: 5000,
        categoryId: "cat1",
        bookingId: "bk1",
        constructionId: "cB", // не совпадает с конструкцией брони (cA)
      }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("booking_construction_mismatch");
  });
});

describe("financeRoutes — закрытие месяца", () => {
  const close = (rt: Runtime) =>
    createApp(rt).request("/api/finance/distributions/2026-07/close", {
      method: "POST",
      headers: auth(),
    });

  test("нет участников с долей — 422", async () => {
    const res = await close(runtimeWith("admin", { income: 100000, participants: [] }).rt);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("no_participants");
  });

  test("доли не дают 100% — 422", async () => {
    const res = await close(
      runtimeWith("admin", {
        income: 100000,
        participants: [{ id: "p1", name: "Инвестор", shares: [{ shareBps: 5000 }] }],
      }).rt,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("shares_not_full");
  });

  test("уже закрыт — 409", async () => {
    const res = await close(
      runtimeWith("admin", {
        income: 100000,
        existingClosed: true,
        participants: [{ id: "p1", name: "Я", shares: [{ shareBps: 10000 }] }],
      }).rt,
    );
    expect(res.status).toBe(409);
  });

  test("закрытие разносит чистый доход по нескольким долям (60/40)", async () => {
    const { rt, state } = runtimeWith("admin", {
      income: 100000,
      expense: 0,
      participants: [
        { id: "p1", name: "A", shares: [{ shareBps: 6000 }] },
        { id: "p2", name: "B", shares: [{ shareBps: 4000 }] },
      ],
    });
    const res = await close(rt);
    expect(res.status).toBe(200);
    expect((await res.json()).netIncome).toBe(100000);
    const byId = Object.fromEntries(
      (state.created ?? []).map((a) => [a.participantId as string, a.amount as number]),
    );
    expect(byId.p1).toBe(60000);
    expect(byId.p2).toBe(40000);
    // Разнесённое ровно равно чистому доходу — копейки не теряются.
    expect((state.created ?? []).reduce((s, a) => s + (a.amount as number), 0)).toBe(100000);
  });

  test("успешное закрытие разносит чистый доход по доле", async () => {
    const { rt, state } = runtimeWith("admin", {
      income: 100000,
      expense: 40000,
      participants: [{ id: "p1", name: "Я", shares: [{ shareBps: 10000 }] }],
    });
    const res = await close(rt);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("closed");
    expect(body.netIncome).toBe(60000);
    expect(state.created).toEqual([
      expect.objectContaining({ participantId: "p1", shareBps: 10000, amount: 60000 }),
    ]);
  });
});
