import { randomUUID } from "node:crypto";
import type { SiteBuild } from "@prisma/client";
import type { ClaimBuildResult, SiteBuildStatus } from "@gsk-tower/contracts";
import type { Runtime } from "../runtime";
import {
  notifySiteBuildFailed,
  notifySiteBuildRecovered,
  notifySiteBuildStalled,
} from "../notifications/telegram";
import { toSiteBuildStatus } from "./site-build-dto";

/** Id единственной строки состояния сборки (singleton). */
export const SITE_BUILD_ID = "site";

/** Сборка дольше этого срока считается зависшей (сборщик умер) и переотдаётся. */
const STUCK_BUILD_MS = 30 * 60_000;

/** Ограничение длины текста ошибки, который храним/показываем. */
const MAX_ERROR_LEN = 2000;

/** Гарантирует наличие singleton-строки и возвращает её. */
async function ensureRow(rt: Runtime): Promise<SiteBuild> {
  return rt.prisma.siteBuild.upsert({
    where: { id: SITE_BUILD_ID },
    create: { id: SITE_BUILD_ID },
    update: {},
  });
}

/**
 * Отметить сохранённую правку публичного контента. Это НЕ запускает сборку:
 * пользователь может сделать несколько изменений в CRM и отдельно нажать
 * «Опубликовать». Если публикация уже запрошена, обновляем `lastChangeAt`,
 * чтобы сборщик забрал свежий снимок после короткой тишины.
 *
 * «Выстрелил-и-забыл»: глотает ошибки, не блокирует ответ API.
 */
export async function markContentChanged(rt: Runtime): Promise<void> {
  try {
    const now = new Date();
    const row = await ensureRow(rt);
    await rt.prisma.siteBuild.update({
      where: { id: SITE_BUILD_ID },
      data: {
        lastContentChangeAt: now,
        ...(row.unpublishedSince ? {} : { unpublishedSince: now }),
        ...(row.pendingSince ? { lastChangeAt: now } : {}),
      },
    });
  } catch (err) {
    console.error("[site-build] markContentChanged:", err);
  }
}

/**
 * Явно поставить накопленные публичные правки в очередь публикации. Если правок
 * нет — просто возвращаем текущий статус. Повторное нажатие во время очереди/
 * сборки безопасно и не создаёт вторую задачу.
 */
export async function requestSitePublish(rt: Runtime): Promise<SiteBuildStatus> {
  const row = await ensureRow(rt);
  if (!row.unpublishedSince || !row.lastContentChangeAt) {
    return toSiteBuildStatus(row);
  }
  const updated = await rt.prisma.siteBuild.update({
    where: { id: SITE_BUILD_ID },
    data: {
      pendingSince: row.pendingSince ?? row.unpublishedSince,
      lastChangeAt: row.lastContentChangeAt,
    },
  });
  return toSiteBuildStatus(updated);
}

/**
 * Решение сборщика «собирать ли сейчас». Атомарно переводит idle/failed →
 * building, если: есть `pendingSince`, прошёл дебаунс после последней правки и
 * сборка сейчас не идёт. Сериализация: ровно один переход в `building`.
 * Зависшую сборку (сборщик умер) предварительно переводим в `failed`.
 */
export async function claimBuild(rt: Runtime): Promise<ClaimBuildResult> {
  const debounceMs = rt.env.REBUILD_DEBOUNCE_SECONDS * 1000;
  let row = await ensureRow(rt);

  if (
    row.status === "building" &&
    row.buildingSince &&
    Date.now() - row.buildingSince.getTime() > STUCK_BUILD_MS
  ) {
    await rt.prisma.siteBuild.updateMany({
      where: { id: SITE_BUILD_ID, status: "building", buildingSince: row.buildingSince },
      data: {
        status: "failed",
        lastError: "Предыдущая сборка не завершилась (сборщик не ответил)",
        buildingSince: null,
        buildId: null,
      },
    });
    row = await ensureRow(rt);
  }

  const due =
    row.pendingSince !== null &&
    row.lastChangeAt !== null &&
    row.status !== "building" &&
    Date.now() - row.lastChangeAt.getTime() >= debounceMs;
  if (!due) return { build: false, buildId: null };

  const buildId = randomUUID();
  // Условие по текущему статусу — оптимистичная блокировка: если кто-то уже
  // забрал сборку, обновится 0 строк и мы не возьмём её второй раз.
  const claimed = await rt.prisma.siteBuild.updateMany({
    where: { id: SITE_BUILD_ID, status: row.status, pendingSince: { not: null } },
    data: {
      status: "building",
      buildingSince: new Date(),
      buildId,
      claimedFor: row.lastChangeAt,
    },
  });
  if (claimed.count !== 1) return { build: false, buildId: null };
  return { build: true, buildId };
}

/**
 * Отчёт сборщика о результате. Успех: статус `idle`, фиксируем `lastSuccessAt`
 * и снимаем текущую заявку на публикацию. Если во время сборки пришли новые
 * правки, оставляем `unpublishedSince`: следующую публикацию пользователь
 * запускает отдельной кнопкой. Сбой: статус `failed`, сайт остаётся на прошлой
 * версии, `pendingSince` держим для повтора. Telegram-алерт — один раз на
 * переход (упало/восстановилось).
 */
export async function reportBuildResult(
  rt: Runtime,
  input: { buildId: string; ok: boolean; error?: string },
): Promise<void> {
  const row = await ensureRow(rt);
  // Отчёт о неактуальной сборке (например, после реанимации зависшей) игнорируем.
  if (row.buildId && input.buildId !== row.buildId) {
    console.warn(
      `[site-build] отчёт о чужой сборке ${input.buildId} (текущая ${row.buildId})`,
    );
    return;
  }
  const now = new Date();

  if (input.ok) {
    const wasFailed = row.status === "failed";
    const newEditsDuringBuild =
      row.lastContentChangeAt !== null &&
      row.claimedFor !== null &&
      row.lastContentChangeAt.getTime() > row.claimedFor.getTime();
    await rt.prisma.siteBuild.update({
      where: { id: SITE_BUILD_ID },
      data: {
        status: "idle",
        lastBuildAt: now,
        lastSuccessAt: now,
        lastError: null,
        buildingSince: null,
        buildId: null,
        claimedFor: null,
        failNotifiedAt: null,
        stallNotifiedAt: null,
        pendingSince: null,
        ...(newEditsDuringBuild ? {} : { unpublishedSince: null, lastContentChangeAt: null }),
      },
    });
    if (wasFailed) void notifySiteBuildRecovered(rt);
    return;
  }

  const error = input.error?.slice(0, MAX_ERROR_LEN) ?? null;
  const alreadyNotified = row.failNotifiedAt !== null;
  await rt.prisma.siteBuild.update({
    where: { id: SITE_BUILD_ID },
    data: {
      status: "failed",
      lastBuildAt: now,
      lastError: error,
      buildingSince: null,
      buildId: null,
      failNotifiedAt: alreadyNotified ? row.failNotifiedAt : now,
    },
  });
  if (!alreadyNotified) void notifySiteBuildFailed(rt, error);
}

/**
 * Зафиксировать успешную публикацию сайта вне авто-конвейера — ручной деплой
 * (`deploy:vps`) сам собирает лендинг на свежих данных. Снимает `pendingSince`
 * (всё опубликовано), сбрасывает флаги алертов; если до этого была ошибка —
 * шлёт «восстановилось».
 */
export async function markPublished(rt: Runtime): Promise<void> {
  const row = await ensureRow(rt);
  const now = new Date();
  await rt.prisma.siteBuild.update({
    where: { id: SITE_BUILD_ID },
    data: {
      status: "idle",
      lastBuildAt: now,
      lastSuccessAt: now,
      lastError: null,
      pendingSince: null,
      unpublishedSince: null,
      lastContentChangeAt: null,
      buildingSince: null,
      buildId: null,
      claimedFor: null,
      failNotifiedAt: null,
      stallNotifiedAt: null,
    },
  });
  if (row.status === "failed") void notifySiteBuildRecovered(rt);
}

/** Статус сборки для CRM-индикатора. */
export async function getStatus(rt: Runtime): Promise<SiteBuildStatus> {
  const row = await ensureRow(rt);
  return toSiteBuildStatus(row);
}

/**
 * Периодический сторожок простоя сборки (раз в минуту). Не держит процесс живым.
 * Вызывается из index.ts по образцу `startSessionSweeper`.
 */
export function startBuildStallWatcher(
  rt: Runtime,
): ReturnType<typeof setInterval> {
  void checkBuildStall(rt);
  const timer = setInterval(() => void checkBuildStall(rt), 60 * 1000);
  timer.unref?.();
  return timer;
}

/**
 * Сторожок простоя: если правки давно ждут, а сборщик их не берёт (статус всё
 * ещё `idle`) — вероятно, сервис-сборщик на хосте не работает. Шлём один алерт.
 * «Выстрелил-и-забыл». Зовётся периодическим таймером (см. index.ts).
 */
export async function checkBuildStall(rt: Runtime): Promise<void> {
  try {
    const stallMs = rt.env.REBUILD_STALL_MINUTES * 60_000;
    const row = await ensureRow(rt);
    const stalled =
      row.status === "idle" &&
      row.pendingSince !== null &&
      Date.now() - row.pendingSince.getTime() > stallMs &&
      row.stallNotifiedAt === null;
    if (!stalled) return;
    await rt.prisma.siteBuild.update({
      where: { id: SITE_BUILD_ID },
      data: { stallNotifiedAt: new Date() },
    });
    void notifySiteBuildStalled(rt, rt.env.REBUILD_STALL_MINUTES);
  } catch (err) {
    console.error("[site-build] checkBuildStall:", err);
  }
}
