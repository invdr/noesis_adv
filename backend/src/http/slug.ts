import { slugify } from "@gsk-tower/contracts";

/**
 * Подобрать свободный slug. База — `slugify(name)` (или `fallback`, если из
 * имени вышла пустая строка). Если занят — добавляем суффикс `-2`, `-3`, …
 * Проверка занятости — через переданный колбэк (он же исключает текущую запись
 * при обновлении). Уникальность считаем по всем записям, включая архивные, —
 * тогда восстановление из архива никогда не конфликтует.
 */
export async function uniqueSlug(
  name: string,
  isTaken: (slug: string) => Promise<boolean>,
  fallback = "item",
): Promise<string> {
  const root = slugify(name) || fallback;
  let candidate = root;
  let n = 1;
  while (await isTaken(candidate)) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}
