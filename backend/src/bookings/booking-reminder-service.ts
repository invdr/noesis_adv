import type { Prisma } from "@prisma/client";
import {
  BOOKING_REMINDER_UPCOMING_DAYS,
  type BookingKind,
  type BookingReminderItem,
  type BookingRemindersQuery,
  type BookingRemindersResponse,
  type BookingStatus,
  type ConstructionSide,
  type SessionUser,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { mskDay } from "../http/msk";
import { sendTelegramMessage } from "../notifications/telegram";
import { previousDateOnly, toDateOnly } from "./booking-periods";

const DAY_MS = 24 * 60 * 60 * 1000;

// На VPS работает один процесс backend. Блокировка по чату не даёт двум
// перекрывающимся cron/manual вызовам отправить один и тот же дайджест, пока
// первый ещё ждёт Telegram и фиксирует результат в БД.
const sendingReminderChats = new Set<string>();

/** Занятость держат `booked`/`onAir`; по ним и напоминаем. */
const ACTIVE_STATUSES: BookingStatus[] = ["booked", "onAir"];

/** Бронь с включёнными связями для строки напоминания. */
type ReminderRow = Prisma.BookingGetPayload<{
  include: {
    construction: { select: { name: true; code: true } };
    constructionSide: { select: { code: true } };
    client: { select: { fullName: true } };
    brand: { select: { name: true } };
    serviceReason: { select: { name: true } };
    manager: { select: { name: true; email: true } };
    createdBy: { select: { name: true; email: true } };
  };
}>;

const reminderInclude = {
  construction: { select: { name: true, code: true } },
  constructionSide: { select: { code: true } },
  client: { select: { fullName: true } },
  brand: { select: { name: true } },
  serviceReason: { select: { name: true } },
  manager: { select: { name: true, email: true } },
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.BookingInclude;

/** Ответственный: менеджер, иначе создатель (Развилка 6). */
function ownerLabel(row: ReminderRow): string | null {
  return (
    row.manager?.name ??
    row.manager?.email ??
    row.createdBy?.name ??
    row.createdBy?.email ??
    null
  );
}

function toReminderItem(row: ReminderRow): BookingReminderItem {
  return {
    id: row.id,
    kind: row.kind as BookingKind,
    status: row.status as BookingStatus,
    constructionName: row.construction.name,
    constructionCode: row.construction.code,
    sideCode: row.constructionSide.code as ConstructionSide,
    clientName: row.client?.fullName ?? null,
    brandName: row.brand?.name ?? null,
    campaignNote: row.campaignNote,
    serviceReasonName: row.serviceReason?.name ?? null,
    startDate: toDateOnly(row.startDate),
    endDate: previousDateOnly(row.endDate),
    reminderAt: toDateOnly(row.reminderAt!),
    managerName: ownerLabel(row),
  };
}

/**
 * «Мой день» по броням: активные брони с назначенным напоминанием, разложенные по
 * дню МСК на просрочено / сегодня / ближайшие 7 дней. Видимость: менеджер — свои
 * (ответственный или, если ответственный не задан, создатель); admin — вся
 * команда (`scope=all`, по умолчанию) либо только свои (`scope=mine`).
 */
export async function getBookingReminders(
  rt: Runtime,
  user: SessionUser,
  query: BookingRemindersQuery,
): Promise<BookingRemindersResponse> {
  const ownOnly = user.role !== "admin" || query.scope === "mine";
  const scopeWhere: Prisma.BookingWhereInput = ownOnly
    ? { OR: [{ managerId: user.id }, { managerId: null, createdById: user.id }] }
    : {};

  const rows = await rt.prisma.booking.findMany({
    where: {
      AND: [
        scopeWhere,
        { reminderAt: { not: null } },
        { status: { in: ACTIVE_STATUSES } },
      ],
    },
    include: reminderInclude,
    orderBy: [{ reminderAt: "asc" }, { startDate: "asc" }],
  });

  const today = mskDay(new Date());
  const upcomingCutoff = mskDay(
    new Date(Date.now() + BOOKING_REMINDER_UPCOMING_DAYS * DAY_MS),
  );
  const groups: BookingRemindersResponse = { overdue: [], today: [], upcoming: [] };
  for (const row of rows) {
    if (!row.reminderAt) continue;
    const item = toReminderItem(row);
    const day = mskDay(row.reminderAt);
    if (day < today) groups.overdue.push(item);
    else if (day === today) groups.today.push(item);
    else if (day <= upcomingCutoff) groups.upcoming.push(item);
    // Дальше 7 дней — вне «Моего дня».
  }
  return groups;
}

export interface DueRemindersResult {
  /** Сколько броней подошло по сроку и ещё не уведомлены. */
  candidates: number;
  /** Скольким ушёл Telegram (и они помечены уведомлёнными). */
  notified: number;
  /** Не отправлены: у адресата нет Telegram либо Telegram вернул ошибку (повторятся позже). */
  skipped: number;
}

type DueReminderRow = ReminderRow & {
  manager: { isActive: boolean; telegramChatId: string | null } | null;
  createdBy: { isActive: boolean; telegramChatId: string | null } | null;
};

interface ReminderDelivery {
  row: DueReminderRow;
  recipientWhere: Prisma.BookingWhereInput;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bookingLabel(row: ReminderRow): string {
  const head = row.construction.code ?? row.construction.name;
  const who =
    row.client?.fullName ??
    row.brand?.name ??
    row.serviceReason?.name ??
    row.campaignNote ??
    null;
  const tail = who ? ` — ${who}` : "";
  return `${head} · ${row.constructionSide.code}${tail}`;
}

/**
 * Telegram-дайджест по броням, у которых подошёл срок напоминания. Дёргается
 * cron-ом на VPS (`POST /api/internal/bookings/reminders/notify`). Идемпотентен:
 * ушедшие напоминания помечаются `reminderNotifiedAt`, повторный запуск их не
 * шлёт; перенос срока брони сбрасывает флаг (перевзвешивание — в saveBooking).
 * Адресат — личный чат ответственного (иначе создателя); если чата нет, бронь
 * не помечаем — уведомление уйдёт, когда менеджер подключит Telegram. Fail-safe:
 * без токена бота ничего не помечаем.
 */
export async function sendDueBookingReminders(rt: Runtime): Promise<DueRemindersResult> {
  const rows = (await rt.prisma.booking.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      reminderAt: { not: null, lte: new Date() },
      reminderNotifiedAt: null,
    },
    include: {
      ...reminderInclude,
      manager: { select: { name: true, email: true, isActive: true, telegramChatId: true } },
      createdBy: { select: { name: true, email: true, isActive: true, telegramChatId: true } },
    },
    orderBy: [{ reminderAt: "asc" }, { startDate: "asc" }],
  })) as DueReminderRow[];

  const result: DueRemindersResult = { candidates: rows.length, notified: 0, skipped: 0 };
  if (rows.length === 0) return result;

  // Без токена бота Telegram выключен — не помечаем, чтобы уведомить позже.
  if (!rt.env.TELEGRAM_BOT_TOKEN) {
    result.skipped = rows.length;
    return result;
  }

  // Группируем по личному чату адресата.
  const byChat = new Map<string, ReminderDelivery[]>();
  for (const row of rows) {
    const recipient = recipientSnapshot(row);
    if (!recipient) {
      result.skipped++;
      continue;
    }
    const bucket = byChat.get(recipient.chatId) ?? [];
    bucket.push({ row, recipientWhere: recipient.where });
    byChat.set(recipient.chatId, bucket);
  }

  for (const [chatId, bucket] of byChat) {
    if (sendingReminderChats.has(chatId)) {
      result.skipped += bucket.length;
      continue;
    }
    sendingReminderChats.add(chatId);
    const lines = ["🔔 <b>Подходит срок броней</b>"];
    try {
      for (const { row } of bucket) {
        lines.push(`• ${escapeHtml(bookingLabel(row))} — до ${previousDateOnly(row.endDate)}`);
      }
      if (rt.env.CRM_BASE_URL) lines.push(`Открыть: ${rt.env.CRM_BASE_URL}/#/bookings`);
      if (await sendTelegramMessage(rt, lines.join("\n"), chatId)) {
        const marked = await Promise.all(
          bucket.map(({ row, recipientWhere }) =>
            rt.prisma.booking.updateMany({
              // A manager can move a reminder or change its recipient while
              // Telegram is responding. Acknowledge only the exact snapshot;
              // an updated date or recipient stays unnotified for a fresh send.
              where: {
                id: row.id,
                reminderAt: row.reminderAt,
                reminderNotifiedAt: null,
                AND: [recipientWhere],
              },
              data: { reminderNotifiedAt: new Date() },
            }),
          ),
        );
        const markedCount = marked.reduce((total, update) => total + update.count, 0);
        result.notified += markedCount;
        result.skipped += bucket.length - markedCount;
      } else {
        result.skipped += bucket.length;
      }
    } finally {
      sendingReminderChats.delete(chatId);
    }
  }
  return result;
}

function recipientSnapshot(
  row: DueReminderRow,
): { chatId: string; where: Prisma.BookingWhereInput } | null {
  if (row.manager?.isActive && row.manager.telegramChatId) {
    return {
      chatId: row.manager.telegramChatId,
      where: {
        manager: {
          is: { isActive: true, telegramChatId: row.manager.telegramChatId },
        },
      },
    };
  }
  if (row.createdBy?.isActive && row.createdBy.telegramChatId) {
    return {
      chatId: row.createdBy.telegramChatId,
      where: {
        createdBy: {
          is: { isActive: true, telegramChatId: row.createdBy.telegramChatId },
        },
        OR: [
          { manager: { is: null } },
          { manager: { is: { isActive: false } } },
          { manager: { is: { telegramChatId: null } } },
        ],
      },
    };
  }
  return null;
}
