import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
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
const REMINDER_CLAIM_TTL_MS = 5 * 60 * 1000;
// Telegram accepts up to 4096 characters. Leave a small margin because this
// digest uses HTML markup and is assembled from user-entered labels.
const TELEGRAM_MESSAGE_MAX_LENGTH = 4000;
const REMINDER_LABEL_MAX_LENGTH = 500;

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

interface ClaimedReminderDelivery extends ReminderDelivery {
  claimToken: string;
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

function reminderLine(row: ReminderRow): string {
  const label = bookingLabel(row);
  const shortened =
    label.length > REMINDER_LABEL_MAX_LENGTH
      ? `${label.slice(0, REMINDER_LABEL_MAX_LENGTH - 1)}…`
      : label;
  return `• ${escapeHtml(shortened)} — до ${previousDateOnly(row.endDate)}`;
}

function reminderMessage(
  deliveries: ClaimedReminderDelivery[],
  crmBaseUrl: string | undefined,
): string {
  const lines = ["🔔 <b>Подходит срок броней</b>"];
  for (const { row } of deliveries) lines.push(reminderLine(row));
  if (crmBaseUrl) lines.push(`Открыть: ${crmBaseUrl}/#/bookings`);
  return lines.join("\n");
}

function splitReminderMessages(
  deliveries: ClaimedReminderDelivery[],
  crmBaseUrl: string | undefined,
): ClaimedReminderDelivery[][] {
  const chunks: ClaimedReminderDelivery[][] = [];
  let chunk: ClaimedReminderDelivery[] = [];
  for (const delivery of deliveries) {
    const candidate = [...chunk, delivery];
    if (
      chunk.length > 0 &&
      reminderMessage(candidate, crmBaseUrl).length > TELEGRAM_MESSAGE_MAX_LENGTH
    ) {
      chunks.push(chunk);
      chunk = [delivery];
    } else {
      chunk = candidate;
    }
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
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
  const now = new Date();
  const staleClaimBefore = new Date(now.getTime() - REMINDER_CLAIM_TTL_MS);
  const rows = (await rt.prisma.booking.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      reminderAt: { not: null, lte: now },
      reminderNotifiedAt: null,
      OR: [
        { reminderSendingToken: null },
        { reminderSendingAt: null },
        { reminderSendingAt: { lt: staleClaimBefore } },
      ],
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
    const claimedBucket = await claimReminderDeliveries(rt, bucket, staleClaimBefore);
    result.skipped += bucket.length - claimedBucket.length;
    if (claimedBucket.length === 0) {
      sendingReminderChats.delete(chatId);
      continue;
    }
    try {
      for (const messageBucket of splitReminderMessages(claimedBucket, rt.env.CRM_BASE_URL)) {
        if (await sendTelegramMessage(rt, reminderMessage(messageBucket, rt.env.CRM_BASE_URL), chatId)) {
          const marked = await Promise.all(
            messageBucket.map(({ row, recipientWhere, claimToken }) =>
              rt.prisma.booking.updateMany({
                // The lease prevents recipient/date changes after the claim and
                // before sendMessage; this is still defensive against stale work.
                where: {
                  id: row.id,
                  status: { in: ACTIVE_STATUSES },
                  reminderAt: row.reminderAt,
                  reminderNotifiedAt: null,
                  reminderSendingToken: claimToken,
                  AND: [recipientWhere],
                },
                data: {
                  reminderNotifiedAt: new Date(),
                  reminderSendingToken: null,
                  reminderSendingAt: null,
                },
              }),
            ),
          );
          const markedCount = marked.reduce((total, update) => total + update.count, 0);
          result.notified += markedCount;
          result.skipped += messageBucket.length - markedCount;
        } else {
          await releaseReminderClaims(rt, messageBucket);
          result.skipped += messageBucket.length;
        }
      }
    } catch (err) {
      await releaseReminderClaims(rt, claimedBucket).catch(() => {});
      throw err;
    } finally {
      sendingReminderChats.delete(chatId);
    }
  }
  return result;
}

async function claimReminderDeliveries(
  rt: Runtime,
  deliveries: ReminderDelivery[],
  staleClaimBefore: Date,
): Promise<ClaimedReminderDelivery[]> {
  const claims = await Promise.all(
    deliveries.map(async (delivery) => {
      const claimToken: string = randomUUID();
      let claimed;
      try {
        claimed = await rt.prisma.$transaction(
          (tx) =>
            tx.booking.updateMany({
              // The recipient snapshot is checked before claiming. Once claimed,
              // booking-service rejects recipient/date changes until this short lease
              // is released or expires, so sendMessage cannot target a stale chat.
              where: {
                id: delivery.row.id,
                status: { in: ACTIVE_STATUSES },
                reminderAt: delivery.row.reminderAt,
                reminderNotifiedAt: null,
                OR: [
                  { reminderSendingToken: null },
                  { reminderSendingAt: null },
                  { reminderSendingAt: { lt: staleClaimBefore } },
                ],
                AND: [delivery.recipientWhere],
              },
              data: { reminderSendingToken: claimToken, reminderSendingAt: new Date() },
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err) {
        if (isSerializationFailure(err)) return null;
        throw err;
      }
      return claimed.count > 0 ? { ...delivery, claimToken } : null;
    }),
  );
  return claims.filter((claim): claim is ClaimedReminderDelivery => claim !== null);
}

async function releaseReminderClaims(
  rt: Runtime,
  deliveries: ClaimedReminderDelivery[],
): Promise<void> {
  await Promise.all(
    deliveries.map(({ row, claimToken }) =>
      rt.prisma.booking.updateMany({
        where: { id: row.id, reminderSendingToken: claimToken },
        data: { reminderSendingToken: null, reminderSendingAt: null },
      }),
    ),
  );
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

function isSerializationFailure(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}
