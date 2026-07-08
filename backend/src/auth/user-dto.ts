import type { User } from "@prisma/client";
import type { SessionUser } from "@gsk-tower/contracts";

/** Маппинг строки БД в DTO текущего пользователя сессии. */
export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}
