import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { SessionUser, UserRole } from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "./errors";
import type { AppEnv } from "./context";
import { SESSION_COOKIE, resolveSession } from "../auth/auth-service";

/**
 * Резолвит сессию из cookie один раз и кладёт пользователя + id сессии в
 * контекст. Общая основа для всех auth-guard'ов — чтобы не резолвить (и не
 * продлевать) сессию дважды при композиции.
 */
async function authenticate(
  rt: Runtime,
  c: Context<AppEnv>,
): Promise<SessionUser> {
  const resolved = await resolveSession(rt, getCookie(c, SESSION_COOKIE));
  if (!resolved) {
    throw new HttpError(401, "unauthorized", "Требуется авторизация");
  }
  c.set("user", resolved.user);
  c.set("sessionId", resolved.sessionId);
  return resolved.user;
}

/**
 * Guard: требует валидную сессию. Кладёт текущего пользователя в контекст
 * (`c.get("user")`) и продлевает TTL сессии при активности.
 */
export function requireAuth(rt: Runtime): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await authenticate(rt, c);
    await next();
  };
}

/**
 * Принудительная смена пароля не должна обходиться в обход webapp: пока
 * `mustChangePassword`, доступны только роуты аутентификации (`/me`,
 * `/change-password`), но не данные и не админ-действия. Общая проверка для
 * `requirePasswordChanged` и `requireRole`.
 */
function assertPasswordChanged(user: SessionUser): void {
  if (user.mustChangePassword) {
    throw new HttpError(
      403,
      "password_change_required",
      "Сначала смените пароль",
    );
  }
}

/**
 * Guard: требует валидную сессию с конкретной ролью (например, `admin`) и
 * уже сменённый пароль (админ-действия — это тоже «данные»: учётка со стартовым
 * паролем не должна, например, создавать пользователей до его смены).
 */
export function requireRole(
  rt: Runtime,
  role: UserRole,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await authenticate(rt, c);
    assertPasswordChanged(user);
    if (user.role !== role) {
      throw new HttpError(403, "forbidden", "Недостаточно прав");
    }
    await next();
  };
}

/** Guard для рабочих эндпоинтов CRM: валидная сессия + пароль уже сменён. */
export function requirePasswordChanged(rt: Runtime): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await authenticate(rt, c);
    assertPasswordChanged(user);
    await next();
  };
}
