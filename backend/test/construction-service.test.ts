import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Runtime } from "../src/runtime";
import {
  createConstruction,
  updateConstruction,
} from "../src/constructions/construction-service";

/**
 * Тесты сохранения конструкции: загрузка фото, обложка/состав галереи,
 * блокировка по версии и гарантия «ноль сирот». БД — in-memory заглушка (движка
 * Prisma в среде нет), эмулирующая ровно те вызовы, что делает сервис; файлы —
 * во временный каталог через реальный сервис файлов.
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "constr-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Заглушка Prisma: ровно операции saveConstruction + сервиса файлов. */
function makeDb() {
  const assets = new Map<string, any>();
  const constructions = new Map<string, any>();
  let seq = 0;
  const id = (p: string) => `${p}_${++seq}`;

  function buildRow(data: any, existing?: any) {
    const imageCreate = data.images?.create ?? [];
    const images = imageCreate.map((ic: any, idx: number) => ({
      id: id("ci"),
      position: ic.position ?? idx,
      assetId: ic.asset.connect.id,
      asset: assets.get(ic.asset.connect.id),
    }));
    const coverId = data.coverId ?? null;
    return {
      id: existing?.id ?? id("constr"),
      slug: data.slug ?? existing?.slug,
      name: data.name ?? existing?.name,
      code: data.code ?? null,
      address: data.address ?? null,
      district: data.district ?? null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      ownerId: data.ownerId ?? null,
      owner: null,
      format: data.format ?? "cityFormat",
      size: data.size ?? null,
      sideCount: data.sideCount ?? 1,
      lighting: data.lighting ?? "none",
      grp: data.grp ?? null,
      trafficPerDay: data.trafficPerDay ?? null,
      pricePerMonth: data.pricePerMonth ?? null,
      description: data.description ?? null,
      coverId,
      cover: coverId ? assets.get(coverId) : null,
      badges: data.badges ?? [],
      status: data.status ?? existing?.status,
      archivedAt: existing?.archivedAt ?? null,
      createdById: data.createdById ?? existing?.createdById ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(Date.now() + (existing ? 1000 : 0)),
      images,
    };
  }

  const db: any = {
    asset: {
      create: async ({ data }: any) => {
        const row = { id: id("asset"), createdAt: new Date(), ...data };
        assets.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }: any) => assets.get(where.id) ?? null,
      delete: async ({ where }: any) => {
        if (!assets.has(where.id)) throw new Error("not found");
        const r = assets.get(where.id);
        assets.delete(where.id);
        return r;
      },
    },
    construction: {
      count: async ({ where }: any) => {
        if (where?.slug !== undefined) {
          const notId = where.id?.not;
          return [...constructions.values()].filter(
            (c) => c.slug === where.slug && c.id !== notId,
          ).length;
        }
        if (where?.id !== undefined) return constructions.has(where.id) ? 1 : 0;
        return constructions.size;
      },
      findUnique: async ({ where }: any) => constructions.get(where.id) ?? null,
      create: async ({ data }: any) => {
        const row = buildRow(data);
        constructions.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = buildRow(data, constructions.get(where.id));
        constructions.set(where.id, row);
        return row;
      },
    },
    constructionImage: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (arg: any) =>
      typeof arg === "function" ? arg(db) : Promise.all(arg),
  };
  return { db, assets, constructions };
}

function runtimeWith(db: any): Runtime {
  return {
    env: { FILES_DIR: dir, FILES_PUBLIC_BASE: "/files" },
    prisma: db,
  } as unknown as Runtime;
}

async function pngFile(name: string, width = 2000): Promise<File> {
  const buf = await sharp({
    create: { width, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  return new File([new Uint8Array(buf)], name, { type: "image/png" });
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p);
    }
  }
  await walk(root);
  return out;
}

describe("createConstruction", () => {
  test("грузит фото, ставит обложку, кладёт оригинал + 3 WebP на каждое фото", async () => {
    const { db } = makeDb();
    const rt = runtimeWith(db);
    const files = new Map([
      ["image_0", await pngFile("a.png")],
      ["image_1", await pngFile("b.png")],
    ]);

    const construction = await createConstruction(
      rt,
      {
        name: "Сити-формат Тест",
        status: "draft",
        images: [
          { kind: "new", uploadIndex: 0 },
          { kind: "new", uploadIndex: 1 },
        ],
        coverIndex: 1,
      } as any,
      files,
      "user_1",
    );

    expect(construction.images).toHaveLength(2);
    expect(construction.cover?.url).toBe(construction.images[1]!.url);
    expect(construction.slug).toBe("siti-format-test");
    // 2 фото × (оригинал + 3 WebP) = 8 файлов
    expect(await listFiles(dir)).toHaveLength(8);
  });

  test("сбой записи конструкции не оставляет загруженных сирот", async () => {
    const { db } = makeDb();
    db.construction.create = async () => {
      throw new Error("db down");
    };
    const rt = runtimeWith(db);

    await expect(
      createConstruction(
        rt,
        {
          name: "СФ-014",
          status: "draft",
          images: [{ kind: "new", uploadIndex: 0 }],
          coverIndex: 0,
        } as any,
        new Map([["image_0", await pngFile("a.png")]]),
        "user_1",
      ),
    ).rejects.toThrow();

    expect(await listFiles(dir)).toHaveLength(0);
  });
});

describe("updateConstruction", () => {
  test("убранное фото удаляется навсегда, новое добавляется", async () => {
    const { db, assets } = makeDb();
    const rt = runtimeWith(db);
    const created = await createConstruction(
      rt,
      {
        name: "СФ-014",
        status: "draft",
        images: [
          { kind: "new", uploadIndex: 0 },
          { kind: "new", uploadIndex: 1 },
        ],
        coverIndex: 0,
      } as any,
      new Map([
        ["image_0", await pngFile("a.png")],
        ["image_1", await pngFile("b.png")],
      ]),
      "user_1",
    );
    const keepId = created.images[0]!.id;
    const removedId = created.images[1]!.id;
    expect(assets.size).toBe(2);

    const updated = await updateConstruction(
      rt,
      created.id,
      {
        name: "СФ-014",
        status: "draft",
        expectedUpdatedAt: created.updatedAt,
        images: [
          { kind: "existing", assetId: keepId },
          { kind: "new", uploadIndex: 0 },
        ],
        coverIndex: 0,
      } as any,
      new Map([["image_0", await pngFile("c.png")]]),
      "user_1",
    );

    expect(updated.images).toHaveLength(2);
    expect(assets.has(removedId)).toBe(false); // убранное фото стёрто
    expect(assets.size).toBe(2);
    expect(await listFiles(dir)).toHaveLength(8);
  });

  test("устаревшая версия → конфликт 409 (блокировка по версии)", async () => {
    const { db } = makeDb();
    const rt = runtimeWith(db);
    const created = await createConstruction(
      rt,
      { name: "СФ-014", status: "draft" } as any,
      new Map(),
      "user_1",
    );

    await expect(
      updateConstruction(
        rt,
        created.id,
        { name: "СФ-015", status: "draft", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" } as any,
        new Map(),
        "user_1",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
