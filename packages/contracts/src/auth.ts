import { z } from "zod";

/** Роли пользователей CRM. */
export const userRoleSchema = z.enum(["admin", "manager"]);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Минимальная длина пароля при смене (мягкая планка). */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Тело запроса на вход в CRM. Идентификатор — email; нормализуем регистр,
 * чтобы вход не зависел от того, как пользователь набрал адрес.
 */
export const loginRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Введите корректный email"),
  password: z.string().min(1, "Введите пароль"),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Текущий пользователь сессии — то, что отдаёт `GET /api/auth/me`. */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  /** Отображаемое имя (ФИО); `null` — показываем email. */
  name: z.string().nullable(),
  role: userRoleSchema,
  /** Требуется сменить пароль при первом входе / после сброса админом. */
  mustChangePassword: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** Смена пароля авторизованным пользователем. */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Минимум ${PASSWORD_MIN_LENGTH} символов`),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
