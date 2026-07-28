import { describe, expect, test } from "bun:test";
import * as contracts from "../src/index";

/**
 * Схемы тела запроса не должны принимать пустой объект.
 *
 * Почему это важно. Часть роутов бэкенда читает тело приёмом
 * `await c.req.json().catch(() => ({}))`: нечитаемое тело подменяется пустым
 * объектом и уходит в схему, чтобы Zod вернул 422 с разбором по полям. Приём
 * безопасен ровно до тех пор, пока схема отвергает `{}`. Стоит появиться схеме
 * тела, у которой все поля необязательные, — и битое тело проходит валидацию
 * как «ничего не менять», а хендлер, пишущий полный снимок, затирает данные и
 * отвечает 200 OK. Ровно так и случилось с `updateSiteSettingsSchema`.
 *
 * Тест фиксирует границу: любая новая схема тела, принимающая `{}`, должна
 * быть либо ужесточена, либо осознанно внесена в список исключений ниже.
 */

/**
 * Схемы, которым принимать `{}` нормально, с причиной.
 * - `*QuerySchema` / `paginationQuerySchema` — разбирают query-параметры, а не
 *   тело: пустой запрос там штатный и означает «фильтров нет».
 * - `siteSettingsBaseSchema` — парсит JSON-колонку из БД, не вход запроса.
 * - `createDealDocumentSchema` — приходит из multipart, а не из json().
 * - `updateSiteSettingsSchema` — единственная схема тела с полностью
 *   необязательными полями; её роут читает тело через `readJsonBody`, который
 *   отдаёт 400 на нечитаемое тело и не подменяет его пустым объектом.
 */
const ALLOWED_EMPTY = new Set([
  "siteSettingsBaseSchema",
  "createDealDocumentSchema",
  "updateSiteSettingsSchema",
]);

function acceptsEmptyObject(schema: unknown): boolean {
  if (
    !schema ||
    typeof schema !== "object" ||
    typeof (schema as { safeParse?: unknown }).safeParse !== "function"
  ) {
    return false;
  }
  try {
    return (schema as { safeParse: (v: unknown) => { success: boolean } }).safeParse({})
      .success;
  } catch {
    return false;
  }
}

describe("схемы тела запроса", () => {
  test("не принимают пустой объект (иначе битое тело = «ничего не менять»)", () => {
    const offenders = Object.entries(contracts)
      .filter(([name]) => !ALLOWED_EMPTY.has(name))
      // Query-схемы разбирают строку запроса, а не тело.
      .filter(([name]) => !/QuerySchema$/.test(name) && name !== "paginationQuerySchema")
      .filter(([, schema]) => acceptsEmptyObject(schema))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });

  test("список исключений не протух — каждая запись всё ещё принимает {}", () => {
    for (const name of ALLOWED_EMPTY) {
      const schema = (contracts as Record<string, unknown>)[name];
      expect(schema, `${name} отсутствует в contracts`).toBeDefined();
      expect(acceptsEmptyObject(schema), `${name} больше не принимает {}`).toBe(true);
    }
  });
});
