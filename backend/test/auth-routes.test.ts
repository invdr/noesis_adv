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

describe("скользящий TTL сессии доходит до браузера", () => {
  /**
   * `resolveSession` продлевала сессию в БД, но cookie ставилась только при
   * входе с фиксированным `maxAge`. Активного пользователя всё равно
   * выбрасывало ровно через SESSION_TTL_HOURS после логина — вопреки тому, что
   * задокументировано у `SESSION_TTL_HOURS` и в самой `resolveSession`.
   */
  const sessionUser = {
    id: "u1",
    email: "m@noesis.ru",
    role: "manager",
    isActive: true,
    mustChangePassword: false,
  };

  function runtimeWithSession(lastSeenAt: Date, onUpdate: () => void) {
    return runtimeWith({
      session: {
        findUnique: async () => ({
          id: "s1",
          userId: "u1",
          lastSeenAt,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          user: sessionUser,
        }),
        update: async () => {
          onUpdate();
          return {};
        },
      },
    });
  }

  async function meRequest(rt: Runtime): Promise<Response> {
    return createApp(rt).request("/api/auth/me", {
      headers: {
        Origin: "http://localhost:5173",
        Cookie: "noesis_session=token-abc",
      },
    });
  }

  test("продлённая сессия перевыставляет cookie тем же токеном", async () => {
    let updated = false;
    // Последняя активность давно — сервис продлевает сессию.
    const rt = runtimeWithSession(new Date(Date.now() - 60 * 60 * 1000), () => {
      updated = true;
    });

    const res = await meRequest(rt);

    expect(res.status).toBe(200);
    expect(updated).toBe(true);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("noesis_session=token-abc");
    expect(cookie).toContain("Max-Age=43200"); // SESSION_TTL_HOURS=12
    // Флаги продления совпадают с теми, что ставит вход.
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  test("свежая сессия не трогает ни БД, ни cookie", async () => {
    let updated = false;
    // Активность только что — писать в БД и слать cookie на каждый запрос не нужно.
    const rt = runtimeWithSession(new Date(), () => {
      updated = true;
    });

    const res = await meRequest(rt);

    expect(res.status).toBe(200);
    expect(updated).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
