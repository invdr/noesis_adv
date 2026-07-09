import type { LeadSource, SessionUser, Lead } from "@noesis/contracts";

export const SOURCE_LABELS: Record<string, string> = {
  hero_form: "Главная форма",
  project: "Карточка конструкции",
  contacts: "Контакты",
  offline: "Оффлайн",
  other: "Прочее",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as LeadSource] ?? source;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU");
}

/** Сдвиг МСК (UTC+3, без летнего времени) — копия backend/src/http/msk.ts. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Календарный день по МСК `YYYY-MM-DD` — бакеты совпадают с «Моим днём». */
export function mskDay(date: Date): string {
  return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

export interface NextContactBadge {
  label: string;
  tone: "danger" | "warn" | "info" | "neutral";
}

/**
 * Статус задачи «следующий контакт» для бейджа: просрочено / сегодня / завтра /
 * дата. Дни считаются по МСК — так же, как бэкенд бакетит «Мой день».
 */
export function nextContactBadge(atIso: string): NextContactBadge {
  const day = mskDay(new Date(atIso));
  const today = mskDay(new Date());
  const tomorrow = mskDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (day < today) return { label: "просрочено", tone: "danger" };
  if (day === today) return { label: "сегодня", tone: "warn" };
  if (day === tomorrow) return { label: "завтра", tone: "info" };
  return { label: new Date(atIso).toLocaleDateString("ru-RU"), tone: "neutral" };
}

/**
 * Может ли пользователь редактировать заявку. Зеркалит правило бэкенда:
 * admin — любую; менеджер — свою или неназначенную. Чужая (взятая другим
 * менеджером) видна read-only.
 */
export function canEditLead(
  user: SessionUser,
  lead: Pick<Lead, "assigneeId">,
): boolean {
  if (user.role === "admin") return true;
  return lead.assigneeId === user.id || lead.assigneeId === null;
}
