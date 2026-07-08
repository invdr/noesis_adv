import type { Lead as PrismaLead } from "@prisma/client";
import type { Runtime } from "../runtime";

/**
 * Заявка с (опционально) развёрнутым названием источника из справочника —
 * сервис заявок передаёт строку с include `sourceOption`.
 */
type LeadForNotify = PrismaLead & { sourceOption?: { name: string } | null };

/** Подпись источника: имя из справочника, фолбэк — сырой id. */
function sourceLabel(lead: LeadForNotify): string {
  return lead.sourceOption?.name ?? lead.source;
}

/** Экранирование под Telegram HTML parse_mode. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Низкоуровневая отправка сообщения в Telegram. «Выстрелил-и-забыл»: если
 * токен/chat id не заданы — тихо выходим; любые сбои только логируются и НЕ
 * ломают вызывающую операцию. Вызывающий код не обязан `await`-ить результат.
 * По умолчанию шлём в чат отдела продаж (`TELEGRAM_CHAT_ID`); `chatId`
 * переопределяет адресата (напр. личка менеджера).
 */
export async function sendTelegramMessage(
  rt: Runtime,
  text: string,
  chatId: string | undefined = rt.env.TELEGRAM_CHAT_ID,
): Promise<void> {
  const token = rt.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return; // уведомления не настроены — тихо выходим

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error(`[telegram] sendMessage ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error("[telegram] сообщение не отправлено:", err);
  }
}

/** Уведомляет чат отдела продаж о новой заявке. */
export async function notifyNewLead(
  rt: Runtime,
  lead: LeadForNotify,
): Promise<void> {
  const lines = [
    "<b>Новая заявка</b>",
    `Имя: ${escapeHtml(lead.name)}`,
    `Телефон: ${escapeHtml(lead.phone)}`,
    `Источник: ${escapeHtml(sourceLabel(lead))}`,
  ];
  if (lead.projectId) lines.push(`ЖК: ${escapeHtml(lead.projectId)}`);
  if (lead.isRepeat) lines.push("⚠️ Повторная заявка");
  lines.push(`Время: ${lead.createdAt.toLocaleString("ru-RU")}`);
  if (rt.env.CRM_BASE_URL) {
    lines.push(`Открыть: ${rt.env.CRM_BASE_URL}/#/leads/${lead.id}`);
  }
  await sendTelegramMessage(rt, lines.join("\n"));
}

/**
 * Личное уведомление менеджеру о назначенной ему заявке (ручное назначение
 * админом или авто-назначение прошлому менеджеру повторной). «Выстрелил-и-забыл»:
 * без `chatId` тихо выходим. Выбор адресата (менеджер с `telegramChatId`, не сам
 * инициатор) — на стороне сервиса.
 */
export async function notifyLeadAssigned(
  rt: Runtime,
  lead: LeadForNotify,
  chatId: string,
): Promise<void> {
  if (!chatId) return;
  const lines = [
    "<b>Вам назначена заявка</b>",
    `Имя: ${escapeHtml(lead.name)}`,
    `Телефон: ${escapeHtml(lead.phone)}`,
    `Источник: ${escapeHtml(sourceLabel(lead))}`,
  ];
  if (lead.isRepeat) lines.push("⚠️ Повторная заявка");
  if (rt.env.CRM_BASE_URL) {
    lines.push(`Открыть: ${rt.env.CRM_BASE_URL}/#/leads/${lead.id}`);
  }
  await sendTelegramMessage(rt, lines.join("\n"), chatId);
}

/**
 * Алерт «сборка сайта упала» (Веха 4.2). Сайт остаётся на последней рабочей
 * версии; шлётся один раз на переход в состояние сбоя (дедуп — в сервисе).
 */
export async function notifySiteBuildFailed(
  rt: Runtime,
  error: string | null,
): Promise<void> {
  const lines = [
    "🔴 <b>Сборка сайта не удалась</b>",
    "Сайт остался на последней рабочей версии. Изменения из CRM пока не опубликованы.",
  ];
  if (error) lines.push(`Причина: ${escapeHtml(error.slice(0, 500))}`);
  await sendTelegramMessage(rt, lines.join("\n"));
}

/** Алерт «сайт снова обновляется» — сборка восстановилась после сбоя. */
export async function notifySiteBuildRecovered(rt: Runtime): Promise<void> {
  await sendTelegramMessage(
    rt,
    "🟢 <b>Сборка сайта восстановлена</b>\nИзменения из CRM снова публикуются.",
  );
}

/**
 * Алерт «пересборка зависла» — правки давно ждут, а сборщик их не забирает
 * (вероятно, сервис-сборщик на хосте не работает). Одноразовый.
 */
export async function notifySiteBuildStalled(
  rt: Runtime,
  minutes: number,
): Promise<void> {
  await sendTelegramMessage(
    rt,
    `⚠️ <b>Сайт не обновляется ~${minutes} мин</b>\nИзменения из CRM ждут пересборки, но сборщик их не берёт. Проверьте сервис сборки на сервере (gsk-site-builder).`,
  );
}
