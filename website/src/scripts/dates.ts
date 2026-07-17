/* Единый источник календарных хелперов сайт-скриптов (главная, каталог,
   карточка, подборка). Правило продукта: минимальный период размещения —
   1 месяц, поэтому дефолт «Окончание» = «Начало» + 1 месяц (задачи автозаполнения
   дат живут поверх этих функций). */

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayLocal(): string {
  return localDate(new Date());
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

export function shortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

/* «Плавающий месяц» с клампом к концу месяца (как в бронях CRM):
   31.01 + 1 мес → 28.02, 31.03 + 1 мес → 30.04. */
export function addMonthsClamped(value: string, months: number): string {
  const [year = 0, month = 0, day = 1] = value.split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return localDate(target);
}

/* Минимально допустимое «Окончание» для выбранного «Начала». */
export function minPeriodEnd(from: string): string {
  return addMonthsClamped(from, 1);
}

/* Автозаполнение пары дат: «Начало» = сегодня (если пусто), «Окончание» =
   +1 месяц от начала; окончание короче месяца подтягивается к минимуму. */
export function defaultPeriod(from: string, to: string, today: string): { from: string; to: string } {
  const start = from || today;
  const minEnd = minPeriodEnd(start);
  const end = to && to >= minEnd ? to : minEnd;
  return { from: start, to: end };
}
