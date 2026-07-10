import { timingSafeEqual } from "node:crypto";

/**
 * Сравнение секрета внутренних server-to-server ручек в постоянное время, чтобы
 * не давать тайминг-сигнал о префиксе токена. Разная длина отклоняется сразу
 * (длина высокоэнтропийного секрета не секрет), совпадающая — через
 * `timingSafeEqual`.
 */
export function safeTokenEquals(
  provided: string | undefined,
  expected: string,
): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
