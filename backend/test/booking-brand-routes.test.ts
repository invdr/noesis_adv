import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { UserRole } from "@noesis/contracts";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/auth-service";
import type { Runtime } from "../src/runtime";

const TOKEN = "booking-brand-route-test-token";
const ORIGIN = "http://localhost:5173";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function runtimeWith(role: UserRole): Runtime {
  return {
    env: {
      CORS_ORIGINS: [ORIGIN],
      COOKIE_SECURE: false,
      SESSION_TTL_HOURS: 12,
    },
    prisma: {
      session: {
        findUnique: async ({ where }: { where: { tokenHash: string } }) =>
          where.tokenHash === tokenHash(TOKEN)
            ? {
                id: "session-1",
                userId: "user-1",
                expiresAt: new Date(Date.now() + 60_000),
                lastSeenAt: new Date(),
                user: {
                  id: "user-1",
                  email: "manager@example.com",
                  name: null,
                  role,
                  mustChangePassword: false,
                  isActive: true,
                },
              }
            : null,
        update: async () => ({}),
      },
      bookingBrand: {
        findFirst: async () => null,
        create: async ({ data }: { data: { name: string; order: number } }) => ({
          id: "brand-1",
          ...data,
          archivedAt: null,
        }),
      },
    },
  } as unknown as Runtime;
}

describe("booking brand routes", () => {
  test("manager может быстро добавить бренд из формы брони", async () => {
    const app = createApp(runtimeWith("manager"));
    const res = await app.request("/api/booking-brands", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=${TOKEN}`,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Новый бренд" }),
    });

    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("Новый бренд");
  });
});
