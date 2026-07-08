/**
 * Обобщённый in-memory лимитер со скользящим окном по первому событию.
 * Один инстанс бэкенда на VPS sweb.ru — памяти процесса достаточно; при
 * горизонтальном масштабировании счётчик нужно вынести в общий стор.
 *
 * Аналог `login-throttle`, но переиспользуемый: приём заявок ограничивает
 * пару «IP + телефон» (мягко к общему NAT) и держит высокий потолок по IP.
 */
export interface SlidingLimiter {
  /** Учитывает событие по ключу и возвращает true, если лимит не превышен. */
  tryConsume(key: string): boolean;
}

interface Bucket {
  count: number;
  firstAt: number;
}

export function slidingLimiter(max: number, windowMs: number): SlidingLimiter {
  const buckets = new Map<string, Bucket>();
  // Уборка протухших вёдер: ключи произвольны (IP, телефоны из запросов), и без
  // неё карта росла бы до рестарта процесса — ведро освобождается при обращении
  // только по СВОЕМУ ключу. Интервал не держит процесс живым (unref).
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.firstAt > windowMs) buckets.delete(key);
    }
  }, windowMs);
  sweeper.unref?.();
  return {
    tryConsume(key: string): boolean {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.firstAt > windowMs) {
        buckets.set(key, { count: 1, firstAt: now });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= max;
    },
  };
}
