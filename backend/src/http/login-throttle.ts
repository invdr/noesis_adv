import { HttpError } from "./errors";

/**
 * Простейший in-memory лимитер попыток входа: защита от перебора пароля на
 * `POST /api/auth/login`. Окно скользящее по первой попытке; ключ — пара
 * IP+email, чтобы не блокировать всех за одним NAT и не дать перебирать
 * один аккаунт с разных адресов.
 *
 * VPS sweb.ru — один инстанс бэкенда, поэтому памяти процесса достаточно;
 * при горизонтальном масштабировании счётчик нужно вынести в общий стор.
 */
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

interface Bucket {
  count: number;
  firstAt: number;
}

const buckets = new Map<string, Bucket>();

// Уборка протухших вёдер: ключ (IP+email) произволен, `liveBucket` чистит запись
// только при повторном обращении по ТОМУ ЖЕ ключу — без развёртки брошенные
// ведра копились бы до рестарта. Интервал не держит процесс живым (unref).
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.firstAt > WINDOW_MS) buckets.delete(key);
  }
}, WINDOW_MS);
sweeper.unref?.();

function liveBucket(key: string, now: number): Bucket | null {
  const bucket = buckets.get(key);
  if (!bucket) return null;
  if (now - bucket.firstAt > WINDOW_MS) {
    buckets.delete(key);
    return null;
  }
  return bucket;
}

/** Бросает 429, если по ключу превышен лимит неудачных попыток. */
export function assertLoginAllowed(key: string): void {
  const bucket = liveBucket(key, Date.now());
  if (bucket && bucket.count >= MAX_ATTEMPTS) {
    throw new HttpError(
      429,
      "too_many_attempts",
      "Слишком много попыток входа. Повторите позже.",
    );
  }
}

/** Учитывает неудачную попытку входа. */
export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const bucket = liveBucket(key, now);
  if (bucket) bucket.count += 1;
  else buckets.set(key, { count: 1, firstAt: now });
}

/** Сбрасывает счётчик после успешного входа. */
export function recordLoginSuccess(key: string): void {
  buckets.delete(key);
}
