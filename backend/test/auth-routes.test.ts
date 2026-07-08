import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Runtime } from "../src/runtime";

function runtimeWith(prisma: any): Runtime {
  return {
    env: {
      CORS_ORIGINS: ["http://localhost:5173"],
      COOKIE_SECURE: false,
      SESSION_TTL_HOURS: 12,
    },
    prisma,
  } as unknown as Runtime;
}

async function loginAttempt(email: string, xff: string): Promise<Response> {
  const app = createApp(
    runtimeWith({
      user: { findUnique: async () => null },
    }),
  );
  return app.request("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5173",
      "X-Forwarded-For": xff,
    },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
}

describe("authRoutes login throttle", () => {
  test("keys attempts by trusted proxy IP, not spoofed first X-Forwarded-For value", async () => {
    const email = "xff-throttle@example.com";

    for (let i = 0; i < 8; i += 1) {
      const res = await loginAttempt(email, `198.51.100.${i}, 203.0.113.7`);
      expect(res.status).toBe(401);
    }

    const blocked = await loginAttempt(email, "198.51.100.99, 203.0.113.7");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({
      error: { code: "too_many_attempts" },
    });
  });
});
