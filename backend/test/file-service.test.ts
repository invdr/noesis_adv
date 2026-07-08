import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { IMAGE_MAX_BYTES } from "@gsk-tower/contracts";
import {
  imageVariantTargets,
  toWebp,
  validateUpload,
} from "../src/files/file-service";

/** Реальный валидный PNG для проверки распознавания и обработки. */
async function makePng(width = 8, height = 8): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe("imageVariantTargets", () => {
  test("крупный оригинал — все три ширины", () => {
    expect(imageVariantTargets(2000)).toEqual([320, 800, 1600]);
  });

  test("без апскейла: лишние ширины обрезаются по оригиналу и дедуплицируются", () => {
    expect(imageVariantTargets(500)).toEqual([320, 500]);
    expect(imageVariantTargets(200)).toEqual([200]);
  });

  test("неизвестная ширина — берём как есть", () => {
    expect(imageVariantTargets(undefined)).toEqual([320, 800, 1600]);
  });
});

describe("validateUpload", () => {
  test("пустой файл отклоняется", async () => {
    await expect(validateUpload(new Uint8Array(0))).rejects.toThrow();
  });

  test("PNG распознаётся по содержимому как изображение", async () => {
    const v = await validateUpload(await makePng());
    expect(v.kind).toBe("image");
    expect(v.mime).toBe("image/png");
    expect(v.ext).toBe("png");
  });

  test("WebP распознаётся по содержимому как изображение", async () => {
    const webp = new Uint8Array(
      await sharp(await makePng(20, 20)).webp().toBuffer(),
    );
    const v = await validateUpload(webp);
    expect(v.kind).toBe("image");
    expect(v.mime).toBe("image/webp");
    expect(v.ext).toBe("webp");
  });

  test("PDF распознаётся как документ", async () => {
    const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"));
    const v = await validateUpload(pdf);
    expect(v.kind).toBe("document");
    expect(v.ext).toBe("pdf");
  });

  test("неизвестное содержимое отклоняется", async () => {
    const junk = new Uint8Array(Buffer.from("это просто текст, не файл"));
    await expect(validateUpload(junk)).rejects.toThrow();
  });

  test("изображение сверх лимита отклоняется (тип валиден, размер — нет)", async () => {
    const png = await makePng();
    // Валидная PNG-сигнатура в начале + добивка сверх лимита.
    const oversized = new Uint8Array(
      Buffer.concat([Buffer.from(png), Buffer.alloc(IMAGE_MAX_BYTES + 16)]),
    );
    await expect(validateUpload(oversized)).rejects.toThrow();
  });
});

describe("toWebp", () => {
  test("отдаёт корректный WebP-буфер", async () => {
    const out = await toWebp(await makePng(40, 40), 16);
    // Контейнер WebP: 'RIFF' .... 'WEBP'.
    expect(out.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(out.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });
});
