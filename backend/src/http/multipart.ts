import type { Context } from "hono";
import { HttpError } from "./errors";

/** Разобранный multipart: JSON-поле `data` + файлы по именам полей. */
export interface ParsedMultipart {
  data: unknown;
  files: Map<string, File>;
}

/**
 * Прочитать multipart-форму сохранения сущности (решение №1 по файлам: данные и
 * новые файлы приходят одним запросом). Поле `data` — JSON со скалярами и
 * составом галереи; файлы — по именам (`image_0`, `logo`, …). Валидацию `data`
 * выполняет вызывающий код через zod-схему.
 */
export async function parseMultipart(c: Context): Promise<ParsedMultipart> {
  const form = await c.req.formData().catch(() => null);
  if (!form) {
    throw new HttpError(415, "expected_multipart", "Ожидался multipart-запрос");
  }
  const files = new Map<string, File>();
  let data: unknown = {};
  for (const [key, value] of form.entries()) {
    // Значение формы — string | File; нестроковое = файл (так уже и есть в
    // FormData), narrowing через typeof переносимо между версиями типов DOM/bun.
    if (typeof value !== "string") {
      files.set(key, value);
    } else if (key === "data") {
      try {
        data = JSON.parse(value);
      } catch {
        throw new HttpError(422, "invalid_data", "Поле data не является JSON");
      }
    }
  }
  return { data, files };
}

/** Байты файла из формы для передачи в сервис файлов. */
export async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
