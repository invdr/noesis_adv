import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import sharp from "sharp";
import type { Runtime } from "../src/runtime";
import { deleteAsset, storeUpload } from "../src/files/file-service";

/**
 * Интеграционные тесты «сердца» фичи: запись на диск, генерация производных и —
 * главное — гарантия «ноль сирот» (решение №1/№4). БД заменяем in-memory заглушкой
 * Prisma (в этой среде нет движка Prisma), файлы пишем во временный каталог.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "files-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Минимальный Runtime с заглушкой Prisma и временным каталогом файлов. */
function runtimeWith(asset: Record<string, unknown>): Runtime {
  return {
    env: { FILES_DIR: dir, FILES_PUBLIC_BASE: "/files" },
    prisma: { asset },
  } as unknown as Runtime;
}

/** Stateful-заглушка Prisma.asset с in-memory хранилищем строк. */
function memoryAsset() {
  const store = new Map<string, Record<string, unknown>>();
  let seq = 0;
  return {
    store,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `asset_${++seq}`, createdAt: new Date(), ...data };
      store.set(row.id as string, row);
      return row;
    },
    findUnique: async ({ where: { id } }: { where: { id: string } }) =>
      store.get(id) ?? null,
    delete: async ({ where: { id } }: { where: { id: string } }) => {
      const row = store.get(id);
      if (!row) throw new Error("not found");
      store.delete(id);
      return row;
    },
  };
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p);
    }
  }
  await walk(root);
  return out;
}

async function makePng(width: number, height = 10): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"));

describe("storeUpload", () => {
  test("изображение: оригинал + 3 WebP-производные на диске, DTO с renditions", async () => {
    const rt = runtimeWith(memoryAsset());
    const asset = await storeUpload(rt, {
      bytes: await makePng(2000),
      originalName: "Фото.PNG",
    });

    expect(asset.kind).toBe("image");
    expect(asset.url.startsWith("/files/")).toBe(true);
    expect(asset.renditions?.variants.map((v) => v.width)).toEqual([
      320, 800, 1600,
    ]);
    // оригинал + 3 производные
    expect(await listFiles(dir)).toHaveLength(4);
  });

  test("документ: один файл на диске, без производных", async () => {
    const rt = runtimeWith(memoryAsset());
    const asset = await storeUpload(rt, {
      bytes: PDF,
      originalName: "Декларация.pdf",
    });

    expect(asset.kind).toBe("document");
    expect(asset.renditions).toBeUndefined();
    expect(await listFiles(dir)).toHaveLength(1);
  });

  test("документ сделки хранится в закрытой подпапке", async () => {
    const db = memoryAsset();
    const rt = runtimeWith(db);
    const asset = await storeUpload(
      rt,
      { bytes: PDF, originalName: "Договор.pdf" },
      { storageScope: "deal" },
    );

    const stored = db.store.get(asset.id)!;
    const storageKey = stored.storageKey as string;
    expect(storageKey).toStartWith("deals/");
    const files = await listFiles(dir);
    expect(files.map((file) => relative(dir, file).replaceAll("\\", "/"))).toEqual([
      storageKey,
    ]);
  });

  test("фотоотчёт брони хранится в закрытой подпапке", async () => {
    const db = memoryAsset();
    const rt = runtimeWith(db);
    const asset = await storeUpload(
      rt,
      { bytes: await makePng(2000), originalName: "placement.png" },
      { storageScope: "bookingReport" },
    );

    const stored = db.store.get(asset.id)!;
    const storageKey = stored.storageKey as string;
    expect(storageKey).toStartWith("booking-reports/");
    expect((await listFiles(dir)).map((file) => relative(dir, file).replaceAll("\\", "/")))
      .toContain(storageKey);
  });

  test("сбой записи в БД не оставляет сирот на диске (решение №1/№4)", async () => {
    const rt = runtimeWith({
      create: async () => {
        throw new Error("db down");
      },
    });

    await expect(
      storeUpload(rt, { bytes: await makePng(2000), originalName: "x.png" }),
    ).rejects.toThrow();

    // всё, что успели записать (оригинал + производные), должно быть подчищено
    expect(await listFiles(dir)).toHaveLength(0);
  });
});

describe("deleteAsset", () => {
  test("удаляет запись и все файлы (оригинал + производные)", async () => {
    const asset = memoryAsset();
    const rt = runtimeWith(asset);
    const created = await storeUpload(rt, {
      bytes: await makePng(2000),
      originalName: "y.png",
    });
    expect(await listFiles(dir)).toHaveLength(4);

    await deleteAsset(rt, created.id);

    expect(asset.store.size).toBe(0);
    expect(await listFiles(dir)).toHaveLength(0);
  });

  test("несуществующий id → 404", async () => {
    const rt = runtimeWith(memoryAsset());
    await expect(deleteAsset(rt, "missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});
