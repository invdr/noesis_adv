import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Runtime } from "../src/runtime";
import {
  addProgressPhotos,
  createProgressAlbum,
  deleteProgressAlbum,
  deleteProgressPhoto,
  listPublicProjectProgress,
  updateProgressAlbum,
} from "../src/progress/progress-service";

function runtimeWith(prisma: any): Runtime {
  return { env: { FILES_PUBLIC_BASE: "/files" }, prisma } as unknown as Runtime;
}

const albumRow = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  projectId: "p1",
  year: 2026,
  month: 6,
  note: null,
  createdAt: new Date("2026-06-30T10:00:00Z"),
  updatedAt: new Date("2026-06-30T10:00:00Z"),
  photos: [],
  ...over,
});

describe("createProgressAlbum", () => {
  test("создаёт альбом периода; note пустой строки → null", async () => {
    const prisma = {
      project: { count: async () => 1 },
      progressAlbum: {
        count: async () => 0,
        create: async ({ data }: any) => albumRow(data),
      },
    };
    const album = await createProgressAlbum(
      runtimeWith(prisma),
      "p1",
      { year: 2026, month: 6, note: "  " },
      "u1",
    );
    expect(album.year).toBe(2026);
    expect(album.month).toBe(6);
    expect(album.note).toBeNull();
  });

  test("повтор периода в рамках ЖК отклоняется (409)", async () => {
    const prisma = {
      project: { count: async () => 1 },
      progressAlbum: { count: async () => 1 },
    };
    await expect(
      createProgressAlbum(runtimeWith(prisma), "p1", { year: 2026, month: 6 }, "u1"),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("гонка: P2002 от unique-констрейнта периода → 409, не 500", async () => {
    const prisma = {
      project: { count: async () => 1 },
      progressAlbum: {
        count: async () => 0, // check-then-act пропустил оба запроса
        create: async () => {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        },
      },
    };
    await expect(
      createProgressAlbum(runtimeWith(prisma), "p1", { year: 2026, month: 6 }, "u1"),
    ).rejects.toMatchObject({ status: 409, code: "period_exists" });
  });
});

describe("updateProgressAlbum", () => {
  test("PATCH с неизменным периодом не конфликтует сам с собой (сценарий saveNote)", async () => {
    const prisma = {
      progressAlbum: {
        findFirst: async () => ({ year: 2026, month: 6 }),
        // requireFreePeriod нашёл бы сам редактируемый альбом → ложный 409
        count: async () => {
          throw new Error("проверка периода не должна вызываться");
        },
        update: async ({ data }: any) => albumRow(data),
      },
    };
    const album = await updateProgressAlbum(runtimeWith(prisma), "p1", "a1", {
      year: 2026,
      month: 6,
      note: "Смонтированы окна",
    });
    expect(album.note).toBe("Смонтированы окна");
  });

  test("смена периода на занятый → 409", async () => {
    const prisma = {
      progressAlbum: {
        findFirst: async () => ({ year: 2026, month: 6 }),
        count: async () => 1,
      },
    };
    await expect(
      updateProgressAlbum(runtimeWith(prisma), "p1", "a1", { year: 2026, month: 7 }),
    ).rejects.toMatchObject({ status: 409, code: "period_exists" });
  });
});

describe("addProgressPhotos", () => {
  // storeUpload реально пишет файлы — используем временный каталог
  // (как в store-upload.test.ts), чтобы проверить гарантию «ноль сирот».
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "progress-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makePng(): Promise<Uint8Array> {
    // ≥1600 по ширине, чтобы родились все 3 WebP-производные (320/800/1600).
    const buf = await sharp({
      create: { width: 2000, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    return new Uint8Array(buf);
  }

  const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"));

  /** File из байтов: slice().buffer даёт точный ArrayBuffer (валидный BlobPart). */
  const asFile = (bytes: Uint8Array, name: string) =>
    new File([bytes.slice().buffer], name);

  async function listFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(d: string): Promise<void> {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else out.push(p);
      }
    }
    await walk(root);
    return out;
  }

  /** Stateful-заглушки Prisma: ассеты + фото альбома с автопозициями. */
  function progressPrisma(over: { failPhotoAt?: number } = {}) {
    const assets = new Map<string, Record<string, unknown>>();
    const photos: Array<{ assetId: string; position: number }> = [];
    let seq = 0;
    return {
      photos,
      assets,
      prisma: {
        progressAlbum: {
          findFirst: async () => ({ year: 2026, month: 6 }),
          findUnique: async () => albumRow(),
        },
        progressPhoto: {
          findFirst: async () =>
            photos.length
              ? { position: Math.max(...photos.map((p) => p.position)) }
              : null,
          create: async ({ data }: any) => {
            if (photos.length === (over.failPhotoAt ?? -1)) {
              throw new Error("db down");
            }
            photos.push({ assetId: data.assetId, position: data.position });
            return data;
          },
        },
        asset: {
          create: async ({ data }: any) => {
            const row = { id: `asset_${++seq}`, createdAt: new Date(), ...data };
            assets.set(row.id, row);
            return row;
          },
          findUnique: async ({ where }: any) => assets.get(where.id) ?? null,
          delete: async ({ where }: any) => {
            const row = assets.get(where.id);
            if (!row) throw new Error("not found");
            assets.delete(where.id);
            return row;
          },
        },
      },
    };
  }

  function rt(prisma: unknown): Runtime {
    return {
      env: { FILES_DIR: dir, FILES_PUBLIC_BASE: "/files" },
      prisma,
    } as unknown as Runtime;
  }

  test("не-изображение → 422, сохранённый asset подчищен (ноль сирот)", async () => {
    const db = progressPrisma();
    await expect(
      addProgressPhotos(rt(db.prisma), "p1", "a1", [asFile(PDF, "доки.pdf")], "u1"),
    ).rejects.toMatchObject({ status: 422, code: "expected_image" });
    expect(db.assets.size).toBe(0);
    expect(db.photos).toHaveLength(0);
    expect(await listFiles(dir)).toHaveLength(0);
  });

  test("сбой записи фото подчищает его файл; добавленные до сбоя остаются", async () => {
    const db = progressPrisma({ failPhotoAt: 1 }); // падает на втором фото
    const png = await makePng();
    await expect(
      addProgressPhotos(
        rt(db.prisma),
        "p1",
        "a1",
        [asFile(png, "1.png"), asFile(png, "2.png")],
        "u1",
      ),
    ).rejects.toThrow("db down");
    // первое фото записано, второе подчищено целиком (БД и диск)
    expect(db.photos).toHaveLength(1);
    expect(db.assets.size).toBe(1);
    const kept = [...db.assets.values()][0]! as { storageKey: string };
    const onDisk = await listFiles(dir);
    expect(onDisk.some((p) => p.endsWith(kept.storageKey.split("/").at(-1)!))).toBe(true);
    // оригинал + 3 производные единственного выжившего ассета
    expect(onDisk).toHaveLength(4);
  });

  test("позиции продолжают нумерацию с последней в альбоме", async () => {
    const db = progressPrisma();
    db.photos.push({ assetId: "existing", position: 4 });
    const png = await makePng();
    await addProgressPhotos(rt(db.prisma), "p1", "a1", [asFile(png, "n.png")], "u1");
    expect(db.photos.at(-1)).toMatchObject({ position: 5 });
  });
});

describe("deleteProgressAlbum", () => {
  test("удаляет альбом и подчищает файлы фото", async () => {
    const deletedAssets: string[] = [];
    let albumDeleted = false;
    const prisma = {
      progressAlbum: {
        findFirst: async () => ({ year: 2026, month: 6 }),
        delete: async () => {
          albumDeleted = true;
        },
      },
      progressPhoto: {
        findMany: async () => [{ assetId: "as1" }, { assetId: "as2" }],
      },
      // deleteAsset читает и удаляет Asset; renditions чистит с диска.
      asset: {
        findUnique: async ({ where }: any) => ({
          id: where.id,
          storageKey: `xx/${where.id}.webp`,
          renditions: [],
        }),
        delete: async ({ where }: any) => {
          deletedAssets.push(where.id);
        },
      },
    };
    await deleteProgressAlbum(
      { env: { FILES_PUBLIC_BASE: "/files", FILES_DIR: "/nonexistent-dir" }, prisma } as unknown as Runtime,
      "p1",
      "a1",
    );
    expect(albumDeleted).toBe(true);
    expect(deletedAssets).toEqual(["as1", "as2"]);
  });
});

describe("deleteProgressPhoto", () => {
  test("удаляет запись и подчищает файл ассета", async () => {
    const deletedAssets: string[] = [];
    let photoDeleted = false;
    const prisma = {
      progressAlbum: { findFirst: async () => ({ year: 2026, month: 6 }) },
      progressPhoto: {
        findFirst: async () => ({ id: "ph1", assetId: "as1" }),
        delete: async () => {
          photoDeleted = true;
        },
      },
      asset: {
        findUnique: async ({ where }: any) => ({
          id: where.id,
          storageKey: `xx/${where.id}.webp`,
          renditions: [],
        }),
        delete: async ({ where }: any) => {
          deletedAssets.push(where.id);
        },
      },
    };
    await deleteProgressPhoto(
      { env: { FILES_PUBLIC_BASE: "/files", FILES_DIR: "/nonexistent-dir" }, prisma } as unknown as Runtime,
      "p1",
      "a1",
      "ph1",
    );
    expect(photoDeleted).toBe(true);
    expect(deletedAssets).toEqual(["as1"]);
  });

  test("фото из чужого альбома → 404", async () => {
    const prisma = {
      progressAlbum: { findFirst: async () => ({ year: 2026, month: 6 }) },
      progressPhoto: { findFirst: async () => null },
    };
    await expect(
      deleteProgressPhoto(runtimeWith(prisma), "p1", "a1", "ghost"),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("listPublicProjectProgress", () => {
  test("неопубликованный/несуществующий ЖК → null", async () => {
    const prisma = { project: { findFirst: async () => null } };
    expect(await listPublicProjectProgress(runtimeWith(prisma), "ghost")).toBeNull();
  });

  test("отдаёт альбомы с фото в DTO (url из publicBase)", async () => {
    const prisma = {
      project: { findFirst: async () => ({ id: "p1" }) },
      progressAlbum: {
        findMany: async ({ where }: any) => {
          // публичная выборка требует непустые альбомы
          expect(where.photos).toEqual({ some: {} });
          return [
            albumRow({
              photos: [
                {
                  id: "ph1",
                  position: 0,
                  asset: {
                    id: "as1",
                    kind: "image",
                    originalName: "1.jpg",
                    mimeType: "image/jpeg",
                    size: 1000,
                    storageKey: "ab/one.jpg",
                    renditions: [],
                    createdAt: new Date(),
                  },
                },
              ],
            }),
          ];
        },
      },
    };
    const albums = await listPublicProjectProgress(runtimeWith(prisma), "aurum");
    expect(albums).toHaveLength(1);
    expect(albums![0]!.photos[0]!.url).toBe("/files/ab/one.jpg");
  });
});
