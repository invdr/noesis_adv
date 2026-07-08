import { randomBytes } from "node:crypto";
import type {
  AdminUser,
  CreateUserInput,
  CreatedUserResponse,
  ResetPasswordResponse,
  UpdateUserInput,
} from "@gsk-tower/contracts";
import type { Prisma } from "@prisma/client";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import {
  createUser as createUserRecord,
  hashPassword,
  terminateUserSessions,
} from "../auth/auth-service";
import { toAdminUserDto } from "./user-dto";

/** Длина генерируемого стартового пароля (в символах). */
const GENERATED_PASSWORD_LENGTH = 14;

/**
 * Генерирует стартовый/сброшенный пароль. Email-канала нет — пароль показывается
 * админу один раз, поэтому делаем его случайным и достаточно длинным (а не
 * «продиктовать слабый»). Алфавит без похожих символов (0/O, 1/l/I).
 */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(GENERATED_PASSWORD_LENGTH);
  let out = "";
  for (let i = 0; i < GENERATED_PASSWORD_LENGTH; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Считает активные (незакрытые) заявки на каждом ответственном. */
async function activeLeadCounts(rt: Runtime): Promise<Map<string, number>> {
  const rows = await rt.prisma.lead.groupBy({
    by: ["assigneeId"],
    where: { assigneeId: { not: null }, stage: { kind: "in_progress" } },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.assigneeId) counts.set(row.assigneeId, row._count._all);
  }
  return counts;
}

/** Список всех учёток для админ-экрана (с числом активных заявок). */
export async function listUsers(rt: Runtime): Promise<AdminUser[]> {
  const [users, counts] = await Promise.all([
    rt.prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    activeLeadCounts(rt),
  ]);
  return users.map((u) => toAdminUserDto(u, counts.get(u.id) ?? 0));
}

/**
 * Создаёт учётку: генерирует пароль, помечает его на смену при первом входе.
 * Возвращает DTO и пароль (показать админу один раз).
 */
export async function createUserAccount(
  rt: Runtime,
  input: CreateUserInput,
): Promise<CreatedUserResponse> {
  await assertEmailFree(rt, input.email);
  const password = generatePassword();
  const user = await createUserRecord(rt, {
    email: input.email,
    name: input.name,
    password,
    role: input.role,
    mustChangePassword: true,
  });
  return { user: toAdminUserDto(user, 0), password };
}

/**
 * Правка учётки: смена email и/или роли. Нельзя менять СВОЮ роль; нельзя
 * разжаловать последнего активного админа. Повышение менеджера в админы
 * возвращает его незакрытые заявки в общую очередь (он перестаёт быть
 * исполнителем).
 */
export async function updateUser(
  rt: Runtime,
  actingUserId: string,
  id: string,
  input: UpdateUserInput,
): Promise<AdminUser> {
  const user = await requireUser(rt, id);

  if (input.email !== undefined && input.email !== user.email) {
    await assertEmailFree(rt, input.email);
  }

  const demotingToManager = input.role === "manager" && user.role === "admin";
  const promotingToAdmin = input.role === "admin" && user.role === "manager";

  if (input.role !== undefined && input.role !== user.role && id === actingUserId) {
    throw new HttpError(409, "self_role", "Нельзя менять собственную роль");
  }
  if (demotingToManager) {
    await assertNotLastAdmin(rt, id);
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.email !== undefined) data.email = input.email;
  if (input.name !== undefined) data.name = input.name.trim() || null;
  if (input.role !== undefined) data.role = input.role;
  // Пустая строка очищает chat id (менеджер снял привязку к личке).
  if (input.telegramChatId !== undefined) {
    data.telegramChatId = input.telegramChatId.trim() || null;
  }

  const updated = await rt.prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data });
    // Повышение в админы: исполнителем admin не выступает — снимаем активные заявки.
    if (promotingToAdmin) await requeueActiveLeads(tx, id);
    return u;
  });
  const count = promotingToAdmin ? 0 : await userActiveLeadCount(rt, id);
  return toAdminUserDto(updated, count);
}

/**
 * Блокировка/разблокировка. Блокировка: нельзя заблокировать себя или последнего
 * активного админа; прекращает сессии и возвращает незакрытые заявки в очередь.
 */
export async function setUserActive(
  rt: Runtime,
  actingUserId: string,
  id: string,
  isActive: boolean,
): Promise<AdminUser> {
  const user = await requireUser(rt, id);

  if (!isActive) {
    if (id === actingUserId) {
      throw new HttpError(409, "self_block", "Нельзя заблокировать собственную учётку");
    }
    await assertNotLastAdmin(rt, id);
  }

  const updated = await rt.prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data: { isActive } });
    if (!isActive) await requeueActiveLeads(tx, id);
    return u;
  });
  // Сессии гасим уже ПОСЛЕ коммита: если транзакция откатится, пользователь не
  // окажется разлогинен «впустую», а заблокированного всё равно добьёт
  // resolveSession (он прекращает сессии неактивного при следующем запросе).
  if (!isActive) await terminateUserSessions(rt, id);
  const count = isActive ? await userActiveLeadCount(rt, id) : 0;
  return toAdminUserDto(updated, count);
}

/**
 * Сброс пароля забывшему: новый сгенерированный пароль, флаг смены при входе,
 * прекращение сессий. Нельзя сбросить пароль самому себе (для этого есть
 * «Сменить пароль»). Возвращает новый пароль (показать админу один раз).
 */
export async function resetUserPassword(
  rt: Runtime,
  actingUserId: string,
  id: string,
): Promise<ResetPasswordResponse> {
  if (id === actingUserId) {
    throw new HttpError(409, "self_reset", "Свой пароль меняйте через «Сменить пароль»");
  }
  await requireUser(rt, id);
  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  await rt.prisma.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true },
  });
  await terminateUserSessions(rt, id);
  return { password };
}

// --- внутреннее ---

async function requireUser(rt: Runtime, id: string) {
  const user = await rt.prisma.user.findUnique({ where: { id } });
  if (!user) throw new HttpError(404, "not_found", "Пользователь не найден");
  return user;
}

async function assertEmailFree(rt: Runtime, email: string): Promise<void> {
  const existing = await rt.prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpError(409, "email_taken", "Этот email уже занят", {
      email: "Email уже используется",
    });
  }
}

/** Бросает, если `id` — единственный активный администратор. */
async function assertNotLastAdmin(rt: Runtime, id: string): Promise<void> {
  const others = await rt.prisma.user.count({
    where: { role: "admin", isActive: true, id: { not: id } },
  });
  if (others === 0) {
    throw new HttpError(
      409,
      "last_admin",
      "Это последний активный администратор — действие оставит систему без админа",
    );
  }
}

/** Возвращает незакрытые заявки пользователя в общую очередь (assigneeId=null). */
function requeueActiveLeads(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<Prisma.BatchPayload> {
  return tx.lead.updateMany({
    where: { assigneeId: userId, stage: { kind: "in_progress" } },
    data: { assigneeId: null },
  });
}

async function userActiveLeadCount(rt: Runtime, userId: string): Promise<number> {
  return rt.prisma.lead.count({
    where: { assigneeId: userId, stage: { kind: "in_progress" } },
  });
}
