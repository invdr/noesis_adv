import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  SITE_BUILD_ID,
  checkBuildStall,
  claimBuild,
  getStatus,
  markContentChanged,
  requestSitePublish,
  reportBuildResult,
} from "../src/site-build/site-build-service";

/**
 * Тесты конвейера публикации (Веха 4.2): ручной запуск, дебаунс,
 * сериализация, переходы статуса. БД — in-memory заглушка singleton-строки SiteBuild,
 * эмулирующая ровно те операции, что делает сервис (Prisma-движка в тестах нет).
 */

function emptyRow() {
  return {
    id: SITE_BUILD_ID,
    status: "idle" as "idle" | "building" | "failed",
    unpublishedSince: null as Date | null,
    lastContentChangeAt: null as Date | null,
    pendingSince: null as Date | null,
    lastChangeAt: null as Date | null,
    buildingSince: null as Date | null,
    buildId: null as string | null,
    claimedFor: null as Date | null,
    lastSuccessAt: null as Date | null,
    lastBuildAt: null as Date | null,
    lastError: null as string | null,
    failNotifiedAt: null as Date | null,
    stallNotifiedAt: null as Date | null,
    updatedAt: new Date(),
  };
}

/** Заглушка Prisma: одна строка SiteBuild + upsert/update/updateMany. */
function makeDb() {
  let row: ReturnType<typeof emptyRow> | null = null;
  const matches = (where: any): boolean => {
    if (!row) return false;
    for (const [k, cond] of Object.entries(where)) {
      const val = (row as any)[k];
      if (cond && typeof cond === "object" && "not" in (cond as any)) {
        const not = (cond as any).not;
        if (not === null ? val === null : val === not) return false;
      } else if (cond instanceof Date) {
        if (!(val instanceof Date) || val.getTime() !== cond.getTime()) return false;
      } else if (val !== cond) {
        return false;
      }
    }
    return true;
  };
  const db: any = {
    siteBuild: {
      upsert: async ({ where, create }: any) => {
        if (!row) row = { ...emptyRow(), ...create, id: where.id };
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        if (!row || row.id !== where.id) throw new Error("not found");
        row = { ...row, ...data, updatedAt: new Date() };
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 };
        row = { ...row!, ...data, updatedAt: new Date() };
        return { count: 1 };
      },
    },
  };
  return { db, get: () => row, set: (patch: Partial<ReturnType<typeof emptyRow>>) => {
    row = { ...(row ?? emptyRow()), ...patch };
  } };
}

function rt(db: any, debounceSeconds = 120, stallMinutes = 15): Runtime {
  return {
    env: {
      REBUILD_DEBOUNCE_SECONDS: debounceSeconds,
      REBUILD_STALL_MINUTES: stallMinutes,
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_CHAT_ID: undefined,
    },
    prisma: db,
  } as unknown as Runtime;
}

const ago = (ms: number) => new Date(Date.now() - ms);

describe("markContentChanged / requestSitePublish", () => {
  test("сохранение ставит unpublishedSince, но не запускает сборку", async () => {
    const { db, get } = makeDb();
    await markContentChanged(rt(db));
    const first = get()!;
    expect(first.unpublishedSince).not.toBeNull();
    expect(first.lastContentChangeAt).not.toBeNull();
    expect(first.pendingSince).toBeNull();
    expect(first.lastChangeAt).toBeNull();
    const firstUnpublished = first.unpublishedSince!.getTime();

    await new Promise((r) => setTimeout(r, 5));
    await markContentChanged(rt(db));
    const second = get()!;
    expect(second.unpublishedSince!.getTime()).toBe(firstUnpublished); // не сдвинулся
    expect(second.lastContentChangeAt!.getTime()).toBeGreaterThanOrEqual(firstUnpublished);
  });

  test("публикация переносит накопленные правки в очередь сборки", async () => {
    const { db, get } = makeDb();
    await markContentChanged(rt(db));
    const status = await requestSitePublish(rt(db));
    expect(status.pending).toBe(true);
    expect(status.unpublished).toBe(true);
    expect(get()!.pendingSince).toEqual(get()!.unpublishedSince);
    expect(get()!.lastChangeAt).toEqual(get()!.lastContentChangeAt);
  });
});

describe("claimBuild", () => {
  test("не собирает, пока не прошёл дебаунс", async () => {
    const { db } = makeDb();
    await markContentChanged(rt(db, 120));
    await requestSitePublish(rt(db, 120)); // lastChangeAt = сейчас
    const res = await claimBuild(rt(db, 120));
    expect(res.build).toBe(false);
  });

  test("собирает после дебаунса и переводит в building", async () => {
    const { db, get, set } = makeDb();
    await markContentChanged(rt(db, 120));
    await requestSitePublish(rt(db, 120));
    set({ lastChangeAt: ago(200_000), pendingSince: ago(200_000) }); // тишина > 120с
    const res = await claimBuild(rt(db, 120));
    expect(res.build).toBe(true);
    expect(res.buildId).not.toBeNull();
    expect(get()!.status).toBe("building");
    expect(get()!.claimedFor).not.toBeNull();
  });

  test("не отдаёт вторую сборку, пока идёт первая (сериализация)", async () => {
    const { db, set } = makeDb();
    await markContentChanged(rt(db, 0));
    await requestSitePublish(rt(db, 0));
    set({ lastChangeAt: ago(1000), pendingSince: ago(1000) });
    const first = await claimBuild(rt(db, 0));
    expect(first.build).toBe(true);
    const second = await claimBuild(rt(db, 0));
    expect(second.build).toBe(false);
  });

  test("реанимирует зависшую сборку (сборщик умер) и переотдаёт", async () => {
    const { db, get, set } = makeDb();
    set({
      status: "building",
      buildingSince: ago(40 * 60_000), // > 30 мин
      pendingSince: ago(40 * 60_000),
      lastChangeAt: ago(40 * 60_000),
      buildId: "old",
    });
    const res = await claimBuild(rt(db, 120));
    expect(res.build).toBe(true);
    expect(res.buildId).not.toBe("old");
    expect(get()!.status).toBe("building");
  });
});

describe("reportBuildResult", () => {
  test("успех → idle, lastSuccessAt, pendingSince снят (новых правок не было)", async () => {
    const { db, get, set } = makeDb();
    const changed = ago(1000);
    set({
      status: "building",
      buildId: "b1",
      unpublishedSince: changed,
      lastContentChangeAt: changed,
      pendingSince: changed,
      lastChangeAt: changed,
      claimedFor: changed,
    });
    await reportBuildResult(rt(db), { buildId: "b1", ok: true });
    const r = get()!;
    expect(r.status).toBe("idle");
    expect(r.lastSuccessAt).not.toBeNull();
    expect(r.pendingSince).toBeNull();
    expect(r.unpublishedSince).toBeNull(); // всё опубликовано
  });

  test("успех, но во время сборки пришли правки → остаются неопубликованные правки без автоповтора", async () => {
    const { db, get, set } = makeDb();
    set({
      status: "building",
      buildId: "b1",
      unpublishedSince: ago(5000),
      lastContentChangeAt: ago(100), // правка ПОЗЖЕ старта сборки
      pendingSince: ago(5000),
      claimedFor: ago(5000), // что покрывала сборка
      lastChangeAt: ago(100), // правка ПОЗЖЕ старта сборки
    });
    await reportBuildResult(rt(db), { buildId: "b1", ok: true });
    const r = get()!;
    expect(r.status).toBe("idle");
    expect(r.pendingSince).toBeNull(); // новая публикация нужна вручную
    expect(r.unpublishedSince).not.toBeNull();
  });

  test("сбой → failed, pendingSince держим, текст ошибки сохранён", async () => {
    const { db, get, set } = makeDb();
    set({ status: "building", buildId: "b1", pendingSince: ago(1000), lastChangeAt: ago(1000), claimedFor: ago(1000) });
    await reportBuildResult(rt(db), { buildId: "b1", ok: false, error: "astro build failed" });
    const r = get()!;
    expect(r.status).toBe("failed");
    expect(r.pendingSince).not.toBeNull(); // повторим
    expect(r.lastError).toBe("astro build failed");
    expect(r.failNotifiedAt).not.toBeNull();
  });

  test("отчёт о чужой (неактуальной) сборке игнорируется", async () => {
    const { db, get, set } = makeDb();
    set({ status: "building", buildId: "current" });
    await reportBuildResult(rt(db), { buildId: "stale", ok: true });
    expect(get()!.status).toBe("building"); // не тронут
  });
});

describe("getStatus", () => {
  test("отдаёт pending и текст ошибки только при failed", async () => {
    const { db, set } = makeDb();
    set({ status: "failed", unpublishedSince: ago(1000), pendingSince: ago(1000), lastError: "boom" });
    const s = await getStatus(rt(db));
    expect(s.status).toBe("failed");
    expect(s.unpublished).toBe(true);
    expect(s.pending).toBe(true);
    expect(s.lastError).toBe("boom");
  });
});

describe("checkBuildStall", () => {
  test("шлёт одноразовый флаг, если правки висят дольше порога и сборщик молчит", async () => {
    const { db, get, set } = makeDb();
    set({ status: "idle", pendingSince: ago(20 * 60_000) }); // > 15 мин
    await checkBuildStall(rt(db, 120, 15));
    expect(get()!.stallNotifiedAt).not.toBeNull();
    const firstAt = get()!.stallNotifiedAt!.getTime();
    await checkBuildStall(rt(db, 120, 15)); // повтор не сдвигает
    expect(get()!.stallNotifiedAt!.getTime()).toBe(firstAt);
  });

  test("не шлёт, если сборка идёт", async () => {
    const { db, get, set } = makeDb();
    set({ status: "building", pendingSince: ago(20 * 60_000) });
    await checkBuildStall(rt(db, 120, 15));
    expect(get()!.stallNotifiedAt).toBeNull();
  });
});
