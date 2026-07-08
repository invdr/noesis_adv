import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import {
  changePasswordRequestSchema,
  loginRequestSchema,
} from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { requireAuth } from "../http/auth";
import { HttpError } from "../http/errors";
import {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} from "../http/login-throttle";
import { clientIp } from "../http/request";
import {
  SESSION_COOKIE,
  changePassword,
  login,
  logout,
} from "./auth-service";

function cookieOptions(rt: Runtime): CookieOptions {
  return {
    httpOnly: true,
    // Strict: cookie не уходит при cross-site переходах — анти-CSRF для входа
    // в CRM (навигация снаружи допускает повторный вход, это приемлемо).
    sameSite: "Strict",
    secure: rt.env.COOKIE_SECURE,
    path: "/",
    maxAge: rt.env.SESSION_TTL_HOURS * 60 * 60,
  };
}

/** Роуты аутентификации. Хендлеры тонкие — логика в auth-service. */
export function authRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Вход: email + пароль → серверная сессия в httpOnly-cookie.
  app.post("/login", async (c) => {
    const input = loginRequestSchema.parse(await c.req.json().catch(() => ({})));
    // Лимит перебора: по IP + email. Считаем только неверные пары логин/пароль.
    const throttleKey = `${clientIp(c)}:${input.email}`;
    assertLoginAllowed(throttleKey);
    try {
      const { user, token } = await login(rt, input);
      recordLoginSuccess(throttleKey);
      setCookie(c, SESSION_COOKIE, token, cookieOptions(rt));
      return c.json(user);
    } catch (err) {
      if (err instanceof HttpError && err.code === "invalid_credentials") {
        recordLoginFailure(throttleKey);
      }
      throw err;
    }
  });

  // Выход: гасим серверную сессию и cookie.
  app.post("/logout", async (c) => {
    await logout(rt, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  // Текущий пользователь сессии.
  app.get("/me", requireAuth(rt), (c) => c.json(c.get("user")));

  // Смена пароля (в т.ч. принудительная при mustChangePassword).
  app.post("/change-password", requireAuth(rt), async (c) => {
    const input = changePasswordRequestSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    const updated = await changePassword(
      rt,
      c.get("user").id,
      c.get("sessionId"),
      input,
    );
    return c.json(updated);
  });

  return app;
}
