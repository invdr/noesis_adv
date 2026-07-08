import { describe, expect, test } from "bun:test";
import { assetSchema } from "@noesis/contracts";
import { toAssetDto } from "../src/files/file-dto";

const cfg = { publicBase: "/files" };

const base = {
  id: "asset_1",
  originalName: "Проектная декларация.pdf",
  mimeType: "application/pdf",
  size: 12345,
  createdById: "user_1",
  createdAt: new Date("2026-06-25T10:00:00.000Z"),
};

describe("toAssetDto", () => {
  test("документ: валидный DTO, ссылка из ключа, без renditions", () => {
    const dto = toAssetDto(
      { ...base, kind: "document", storageKey: "ab/abcd.pdf", renditions: [] },
      cfg,
    );
    expect(() => assetSchema.parse(dto)).not.toThrow();
    expect(dto.url).toBe("/files/ab/abcd.pdf");
    expect(dto.renditions).toBeUndefined();
    expect(dto.createdAt).toBe("2026-06-25T10:00:00.000Z");
  });

  test("изображение: renditions сортируются, srcset и тумба собираются", () => {
    const dto = toAssetDto(
      {
        ...base,
        kind: "image",
        mimeType: "image/jpeg",
        originalName: "cover.jpg",
        storageKey: "cd/cdef.jpg",
        // намеренно не по возрастанию — DTO должен отсортировать
        renditions: [
          { width: 1600, key: "cd/cdef_1600.webp" },
          { width: 320, key: "cd/cdef_320.webp" },
          { width: 800, key: "cd/cdef_800.webp" },
        ],
      },
      cfg,
    );
    expect(() => assetSchema.parse(dto)).not.toThrow();
    expect(dto.renditions?.variants.map((v) => v.width)).toEqual([320, 800, 1600]);
    expect(dto.renditions?.thumbnailUrl).toBe("/files/cd/cdef_320.webp");
    expect(dto.renditions?.srcset).toBe(
      "/files/cd/cdef_320.webp 320w, /files/cd/cdef_800.webp 800w, /files/cd/cdef_1600.webp 1600w",
    );
  });

  test("изображение без производных — renditions отсутствует", () => {
    const dto = toAssetDto(
      { ...base, kind: "image", storageKey: "ef/efff.png", renditions: [] },
      cfg,
    );
    expect(dto.renditions).toBeUndefined();
  });
});
