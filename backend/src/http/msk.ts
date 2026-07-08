/**
 * Хелперы московского времени (UTC+3, без переходов на летнее время). Един для
 * аналитики (бакетинг по дням/неделям) и «Моего дня» (просрочено/сегодня/скоро).
 */

/** Сдвиг МСК в миллисекундах. */
export const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Календарный день по МСК в формате `YYYY-MM-DD`. */
export function mskDay(date: Date): string {
  return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Начало недели (понедельник, 00:00 МСК) в формате `YYYY-MM-DD` — для динамики
 * по неделям. Дата-только-строка выровнена на понедельник, поэтому шаг «+7 дней»
 * в UTC остаётся на понедельниках.
 */
export function mskWeekStart(date: Date): string {
  const msk = new Date(date.getTime() + MSK_OFFSET_MS);
  const dow = (msk.getUTCDay() + 6) % 7; // 0 = понедельник … 6 = воскресенье
  msk.setUTCDate(msk.getUTCDate() - dow);
  return msk.toISOString().slice(0, 10);
}
