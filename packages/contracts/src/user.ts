import { z } from "zod";
import { userRoleSchema } from "./auth";

/**
 * Создание учётки админом (публичной регистрации нет). Пароль в инпут НЕ входит —
 * он генерируется на сервере и показывается админу один раз. Email нормализуем
 * так же, как при входе, чтобы логин не зависел от регистра/пробелов.
 */
export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Введите корректный email"),
  /** ФИО сотрудника (необязательно при создании, можно дозаполнить потом). */
  name: z.string().trim().max(120).optional(),
  role: userRoleSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Правка учётки админом: email (логин), ФИО и/или роль. Все поля опциональны. */
export const updateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Введите корректный email").optional(),
    name: z.string().trim().max(120).optional(),
    role: userRoleSchema.optional(),
    /**
     * Telegram chat id менеджера для личных уведомлений о назначении заявки.
     * Пустая строка — очистить. Числовой id (или @username) до 64 символов.
     */
    telegramChatId: z.string().trim().max(64).optional(),
  })
  .refine(
    (v) =>
      v.email !== undefined ||
      v.role !== undefined ||
      v.name !== undefined ||
      v.telegramChatId !== undefined,
    { message: "Нечего обновлять" },
  );
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * Учётка в админ-списке. `activeLeadCount` — число незакрытых заявок на
 * пользователе (этап `kind=in_progress`): админ видит, что вернётся в очередь
 * при блокировке/повышении.
 */
export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  /** Отображаемое имя (ФИО); `null` — не задано. */
  name: z.string().nullable(),
  role: userRoleSchema,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
  activeLeadCount: z.number().int(),
  /** Telegram chat id для личных уведомлений; `null` — не задан. */
  telegramChatId: z.string().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

/** Ответ создания пользователя: учётка + сгенерированный пароль (показать разово). */
export const createdUserResponseSchema = z.object({
  user: adminUserSchema,
  password: z.string(),
});
export type CreatedUserResponse = z.infer<typeof createdUserResponseSchema>;

/** Ответ сброса пароля: новый сгенерированный пароль (показать разово). */
export const resetPasswordResponseSchema = z.object({
  password: z.string(),
});
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;
