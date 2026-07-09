import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().optional(),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:4321,http://localhost:5173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Время жизни сессии в часах; продлевается при активности. */
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
    /**
     * Cookie сессии помечается `Secure`. По умолчанию включается в проде
     * (`NODE_ENV=production`), чтобы случайно не отдать cookie по HTTP;
     * в dev по HTTP — выключено. Можно переопределить явно.
     */
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : value === "true",
      ),
    /** Учётка первого администратора для сид-команды (в API не используется). */
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().min(8).optional(),
    /**
     * Уведомления о новых заявках в Telegram-чат отдела продаж. Если токен или
     * chat id не заданы — уведомления тихо отключены (заявки создаются как
     * обычно). Секреты только в `.env`, не в репозитории.
     */
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),
    /** Базовый URL CRM для ссылки на заявку в уведомлении (без хвостового /). */
    CRM_BASE_URL: z
      .string()
      .url()
      .optional()
      .transform((value) => value?.replace(/\/+$/, "")),
    /**
     * Автопересборка лендинга (Веха 4.2). Дебаунс — сколько секунд тишины после
     * последней правки контента ждём перед сборкой (склеивает пачку правок).
     */
    REBUILD_DEBOUNCE_SECONDS: z.coerce.number().int().nonnegative().default(120),
    /**
     * Через сколько минут «зависшей» очереди (правки ждут, сборщик не берёт)
     * слать одноразовый Telegram-алерт. Ловит неработающий сервис-сборщик.
     */
    REBUILD_STALL_MINUTES: z.coerce.number().int().positive().default(15),
    /**
     * Секрет для внутренних ручек сборщика (`/api/internal/site-build/*`).
     * Сборщик на хосте шлёт его в заголовке `X-Build-Token`. Если не задан —
     * внутренние ручки выключены (404), фоновая публикация не активна.
     */
    BUILD_WORKER_TOKEN: z.string().optional(),
    /**
     * Каталог хранения загруженных файлов (фото конструкций, документы). На VPS —
     * постоянный том, который раздаёт nginx; в репозиторий не попадает.
     */
    FILES_DIR: z.string().default("uploads"),
    /**
     * Публичный префикс ссылок на файлы (как их раздаёт nginx). Ключ файла
     * на диске дописывается к нему: `${FILES_PUBLIC_BASE}/${storageKey}`.
     */
    FILES_PUBLIC_BASE: z
      .string()
      .default("/files")
      .transform((value) => value.replace(/\/+$/, "")),
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
  }));

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Валидирует и кэширует переменные окружения. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Некорректное окружение бэкенда:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
