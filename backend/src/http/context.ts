import type { SessionUser } from "@gsk-tower/contracts";

/** Переменные, которые auth-guard'ы кладут в контекст Hono. */
export interface AppEnv {
  Variables: {
    /** Текущий пользователь сессии (есть после `requireAuth`/`requireRole`). */
    user: SessionUser;
    /** Id текущей сессии (есть после `requireAuth`/`requireRole`). */
    sessionId: string;
  };
}
