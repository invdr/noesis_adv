import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

/** Ошибка приложения с HTTP-кодом и машинным кодом. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Единый обработчик ошибок Hono → форма apiErrorSchema из contracts. */
export function onError(err: Error, c: Context): Response {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    return c.json(
      { error: { code: "validation_error", message: "Проверьте поля формы", fields } },
      422,
    );
  }
  if (err instanceof HttpError) {
    return c.json(
      { error: { code: err.code, message: err.message, fields: err.fields } },
      err.status as ContentfulStatusCode,
    );
  }
  console.error("Необработанная ошибка:", err);
  return c.json(
    { error: { code: "internal_error", message: "Внутренняя ошибка сервера" } },
    500,
  );
}
