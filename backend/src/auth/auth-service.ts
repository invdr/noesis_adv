import { createHash, randomBytes } from "node:crypto";
import type {
  ChangePasswordRequest,
  LoginRequest,
  SessionUser,
  UserRole,
} from "@noesis/contracts";
import type { User } from "@prisma/client";
import type { CookieOptions } from "hono/utils/cookie";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { toSessionUser } from "./user-dto";

/** Имя cookie с токеном сессии. */
export const SESSION_COOKIE = "noesis_session";

/** Хеш пароля (argon2id через встроенный Bun.password). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/** Случайный токен сессии (попадает в cookie). */
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** В БД храним только хеш токена — утечка таблицы не отдаёт живые сессии. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ttlExpiry(rt: Runtime): Date {
  return new Date(Date.now() + rt.env.SESSION_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * Минимальный интервал между продлениями сессии. Без него скользящий TTL
 * писал бы в БД на КАЖДЫЙ авторизованный запрос (включая поллинг списка
 * заявок) — лишняя нагрузка и блокировки строки. Продлеваем не чаще раза в N.
 */
const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Создаёт серверную сессию и возвращает сырой токен для cookie. */
async function createSession(rt: Runtime, userId: string): Promise<string> {
  const token = generateToken();
  await rt.prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: ttlExpiry(rt) },
  });
  return token;
}

/** Прекращает все сессии пользователя (выход/блокировка/смена пароля). */
export async function terminateUserSessions(
  rt: Runtime,
  userId: string,
): Promise<void> {
  await rt.prisma.session.deleteMany({ where: { userId } });
}

/**
 * Фоновая уборка протухших сессий. Иначе брошенные сессии (закрытая вкладка)
 * копятся в таблице бесконечно — ленивое удаление при использовании их не
 * трогает. Запускается из точки входа API.
 */
export function startSessionSweeper(rt: Runtime): ReturnType<typeof setInterval> {
  const sweep = () =>
    rt.prisma.session
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch((err: unknown) => console.error("Не удалось очистить сессии:", err));
  void sweep();
  const timer = setInterval(sweep, 60 * 60 * 1000);
  // Не держим процесс живым ради уборки.
  timer.unref?.();
  return timer;
}

export interface LoginResult {
  user: SessionUser;
  token: string;
}

/** Вход по email + паролю. Возвращает пользователя и токен сессии. */
export async function login(
  rt: Runtime,
  input: LoginRequest,
): Promise<LoginResult> {
  const user = await rt.prisma.user.findUnique({
    where: { email: input.email },
  });
  const invalid = () =>
    new HttpError(401, "invalid_credentials", "Неверный email или пароль");

  // Сверяем пароль всегда (в т.ч. при отсутствии юзера) — ровное время ответа,
  // чтобы по задержке нельзя было перебирать существующие email.
  const ok = await verifyPassword(
    input.password,
    user ? user.passwordHash : await getDecoyHash(),
  );

  if (!user || !ok) throw invalid();
  if (!user.isActive) {
    throw new HttpError(403, "user_blocked", "Учётная запись заблокирована");
  }

  const token = await createSession(rt, user.id);
  return { user: toSessionUser(user), token };
}

// Реальный argon2-хеш случайной строки: с ним verify для несуществующего
// пользователя занимает столько же времени, сколько для настоящего.
let decoyHash: Promise<string> | null = null;
function getDecoyHash(): Promise<string> {
  if (!decoyHash) decoyHash = hashPassword(randomBytes(24).toString("hex"));
  return decoyHash;
}

/** Завершает сессию по токену (logout). */
export async function logout(
  rt: Runtime,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await rt.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export interface ResolvedSession {
  user: SessionUser;
  /** Id текущей сессии — нужен, например, чтобы сохранить её при смене пароля. */
  sessionId: string;
  /**
   * Сессия была продлена в этом запросе. Guard по этому флагу перевыставляет
   * cookie: без этого скользящий TTL жил только в БД, а браузер всё равно
   * выбрасывал пользователя через `SESSION_TTL_HOURS` после входа.
   */
  refreshed: boolean;
}

/**
 * Проверяет токен сессии: TTL, активность пользователя; при успехе (не чаще
 * раза в `SESSION_REFRESH_INTERVAL_MS`) продлевает сессию (скользящий TTL) и
 * возвращает текущего пользователя вместе с id сессии.
 */
export async function resolveSession(
  rt: Runtime,
  token: string | undefined,
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const session = await rt.prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await rt.prisma.session
      .delete({ where: { id: session.id } })
      .catch(() => undefined);
    return null;
  }

  // Заблокированный пользователь — прекращаем все его сессии.
  if (!session.user.isActive) {
    await terminateUserSessions(rt, session.userId);
    return null;
  }

  // Скользящий TTL: продлеваем только если с последней активности прошёл
  // заметный интервал — иначе писали бы в БД на каждый запрос.
  let refreshed = false;
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_REFRESH_INTERVAL_MS) {
    await rt.prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: ttlExpiry(rt) },
    });
    refreshed = true;
  }
  return { user: toSessionUser(session.user), sessionId: session.id, refreshed };
}

/**
 * Параметры cookie сессии. Живут в сервисе, а не в роутах, потому что их
 * ставит и guard при продлении скользящего TTL: разъехавшиеся наборы флагов
 * означали бы, что продление втихую меняет, например, `secure` или `sameSite`.
 */
export function sessionCookieOptions(rt: Runtime): CookieOptions {
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

/**
 * Смена пароля авторизованным пользователем. Снимает флаг `mustChangePassword`,
 * прекращает все остальные сессии (текущая — по `currentSessionId` —
 * сохраняется) и возвращает обновлённый DTO пользователя.
 */
export async function changePassword(
  rt: Runtime,
  userId: string,
  currentSessionId: string,
  input: ChangePasswordRequest,
): Promise<SessionUser> {
  const user = await rt.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(401, "unauthorized", "Требуется авторизация");

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) {
    throw new HttpError(400, "invalid_password", "Текущий пароль неверен", {
      currentPassword: "Неверный пароль",
    });
  }

  const passwordHash = await hashPassword(input.newPassword);
  const updated = await rt.prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });

  // Сохраняем только текущую сессию (по её id), остальные гасим.
  await rt.prisma.session.deleteMany({
    where: { userId, id: { not: currentSessionId } },
  });
  return toSessionUser(updated);
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: UserRole;
  name?: string;
  mustChangePassword?: boolean;
}

/**
 * Создаёт пользователя с хешированным паролем (сид-команда и будущий
 * admin-CRUD из Вехи 5). Публичной регистрации нет.
 */
export async function createUser(
  rt: Runtime,
  input: CreateUserInput,
): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  return rt.prisma.user.create({
    data: {
      email: input.email.trim().toLowerCase(),
      name: input.name?.trim() || null,
      passwordHash,
      role: input.role,
      mustChangePassword: input.mustChangePassword ?? false,
    },
  });
}
