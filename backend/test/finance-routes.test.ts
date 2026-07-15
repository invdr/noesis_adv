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
  participants?: { id: string; name: string; shares: { shareBps: number }[] }[];
  existingClosed?: boolean;
}

function runtimeWith(role: UserRole | null, opts: Opts = {}) {
  const state: { created: Record<string, unknown>[] | null } = { created: null };
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
          return {
            status: "closed",
            totalIncome: opts.income ?? 0,
            totalExpense: opts.expense ?? 0,
            netIncome: (opts.income ?? 0) - (opts.expense ?? 0),
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
