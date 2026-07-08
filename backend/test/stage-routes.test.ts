import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { UserRole } from "@gsk-tower/contracts";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/auth-service";
import type { Runtime } from "../src/runtime";

const TOKEN = "stage-route-test-token";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const stageRow = {
  id: "stage_new",
  name: "Новая",
  kind: "in_progress",
  funnelId: "funnel_default",
  isEntry: true,
  order: 1,
  color: "blue",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function runtimeWith(role: UserRole, seenWhere: unknown[]): Runtime {
  return {
    env: {
      CORS_ORIGINS: ["http://localhost:5173"],
      COOKIE_SECURE: false,
      SESSION_TTL_HOURS: 12,
    },
    prisma: {
      session: {
        findUnique: async ({ where }: { where: { tokenHash: string } }) =>
          where.tokenHash === tokenHash(TOKEN)
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
      },
      stage: {
        findMany: async ({ where }: { where: unknown }) => {
          seenWhere.push(where);
          return [stageRow];
        },
      },
    },
  } as unknown as Runtime;
}

async function stagesRequest(role: UserRole, seenWhere: unknown[]): Promise<Response> {
  const app = createApp(runtimeWith(role, seenWhere));
  return await app.request("/api/stages?includeArchived=true", {
    headers: { Cookie: `${SESSION_COOKIE}=${TOKEN}` },
  });
}

describe("stageRoutes includeArchived gate", () => {
  test("manager cannot include archived stages through query string", async () => {
    const seenWhere: unknown[] = [];

    const res = await stagesRequest("manager", seenWhere);

    expect(res.status).toBe(200);
    expect(seenWhere).toEqual([{ archivedAt: null }]);
  });

  test("admin can include archived stages with exact includeArchived=true", async () => {
    const seenWhere: unknown[] = [];

    const res = await stagesRequest("admin", seenWhere);

    expect(res.status).toBe(200);
    expect(seenWhere).toEqual([{}]);
  });
});
