import type { User } from "@prisma/client";
import type { AdminUser } from "@noesis/contracts";

/** Маппинг строки БД в DTO учётки для админ-списка. */
export function toAdminUserDto(user: User, activeLeadCount: number): AdminUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    activeLeadCount,
    telegramChatId: user.telegramChatId ?? null,
  };
}
