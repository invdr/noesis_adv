import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { Prisma, type Asset as PrismaAsset } from "@prisma/client";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_EXT,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_EXT,
  IMAGE_VARIANT_WIDTHS,
  type Asset,
  type AssetKind,
} from "@noesis/contracts";
import type { Env } from "../env";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { toAssetDto, type StoredRendition } from "./file-dto";

/** Сырой файл на входе сервиса. */
export interface UploadInput {
  bytes: Uint8Array;
  originalName: string;
}

/** Место хранения файла. Закрытые документы сделки не должны попасть под `/files/`. */
export type AssetStorageScope = "public" | "deal";

/** Результат валидации: распознанный тип по содержимому. */
export interface ValidatedUpload {
  kind: AssetKind;
  mime: string;
  ext: string;
}

const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024);

/**
 * Валидация по содержимому (magic bytes) и размеру — чистая функция, без диска
 * и БД (легко тестировать). Расширение имени файла игнорируется: тип берём из
 * сигнатуры. Бросает `HttpError` при пустом/слишком большом/недопустимом файле.
 */
export async function validateUpload(
  bytes: Uint8Array,
): Promise<ValidatedUpload> {
  const size = bytes.byteLength;
  if (size === 0) {
    throw new HttpError(422, "empty_file", "Файл пустой");
  }

  const sniffed = await fileTypeFromBuffer(bytes);
  const mime = sniffed?.mime ?? "";

  if (mime in IMAGE_MIME_EXT) {
    if (size > IMAGE_MAX_BYTES) {
      throw new HttpError(
        413,
        "file_too_large",
        `Изображение больше ${mb(IMAGE_MAX_BYTES)} МБ`,
      );
    }
    return {
      kind: "image",
      mime,
      ext: IMAGE_MIME_EXT[mime as keyof typeof IMAGE_MIME_EXT],
    };
  }

  if (mime in DOCUMENT_MIME_EXT) {
    if (size > DOCUMENT_MAX_BYTES) {
      throw new HttpError(
        413,
        "file_too_large",
        `Документ больше ${mb(DOCUMENT_MAX_BYTES)} МБ`,
      );
    }
    return {
      kind: "document",
      mime,
      ext: DOCUMENT_MIME_EXT[mime as keyof typeof DOCUMENT_MIME_EXT],
    };
  }

  throw new HttpError(415, "unsupported_type", "Недопустимый тип файла");
}

/**
 * Ширины производных под `srcset`, обрезанные по ширине оригинала (без
 * апскейла) и без дублей. Если ширина оригинала неизвестна — берём как есть.
 */
export function imageVariantTargets(srcWidth?: number): number[] {
  const targets = new Set<number>();
  for (const width of IMAGE_VARIANT_WIDTHS) {
    targets.add(srcWidth && srcWidth > 0 ? Math.min(width, srcWidth) : width);
  }
  return [...targets].sort((a, b) => a - b);
}

/** WebP-производная заданной ширины (без апскейла). */
export async function toWebp(
  bytes: Uint8Array,
  width: number,
): Promise<Buffer> {
  return sharp(Buffer.from(bytes))
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Принять файл: валидировать, записать оригинал, для изображений сгенерировать
 * WebP-производные под `srcset`, сохранить метаданные и вернуть DTO. Обработка
 * синхронная (решение №3). При любом сбое уже записанные на диск файлы
 * удаляются — не оставляем сирот (решение №1/№4).
 *
 * Вызывается из сохранения сущности (конструкция/новость/документ); может участвовать в
 * её транзакции — на ошибку коммита внешний код вызывает `deleteAsset`.
 */
export async function storeUpload(
  rt: Runtime,
  input: UploadInput,
  opts: { createdById?: string | null; storageScope?: AssetStorageScope } = {},
): Promise<Asset> {
  const validated = await validateUpload(input.bytes);
  const dir = filesDir(rt.env);
  const prefix = opts.storageScope === "deal" ? "deals" : "";
  const written: string[] = [];

  try {
    const name = await writeOriginalUnique(dir, prefix, validated.ext, input.bytes);
    const originalKey = scopedKey(prefix, shardKey(name, validated.ext));
    written.push(originalKey);

    const renditions: StoredRendition[] = [];
    if (validated.kind === "image") {
      for (const variant of await renderImageVariants(input.bytes)) {
        const key = scopedKey(prefix, shardKey(`${name}_${variant.width}`, "webp"));
        await writeBinary(dir, key, variant.bytes);
        written.push(key);
        renditions.push({ width: variant.width, key });
      }
    }

    const asset = await rt.prisma.asset.create({
      data: {
        kind: validated.kind,
        originalName: sanitizeOriginalName(input.originalName),
        mimeType: validated.mime,
        size: input.bytes.byteLength,
        storageKey: originalKey,
        renditions: renditions as unknown as Prisma.InputJsonValue,
        createdById: opts.createdById ?? null,
      },
    });
    return toAssetDto(asset, { publicBase: rt.env.FILES_PUBLIC_BASE });
  } catch (err) {
    await cleanupKeys(dir, written);
    throw err;
  }
}

/**
 * Удалить файл: запись из БД и все его файлы с диска (оригинал + производные).
 * Необратимо (решение №4) — корзины нет. Сначала удаляем запись, затем файлы:
 * повторный вызов на отсутствующей записи даст 404, а не упадёт на диске.
 */
export async function deleteAsset(rt: Runtime, id: string): Promise<void> {
  const asset = await rt.prisma.asset.findUnique({ where: { id } });
  if (!asset) {
    throw new HttpError(404, "not_found", "Файл не найден");
  }
  const stored = (asset.renditions as StoredRendition[] | null) ?? [];
  const keys = [asset.storageKey, ...stored.map((r) => r.key)];
  await rt.prisma.asset.delete({ where: { id } });
  await cleanupKeys(filesDir(rt.env), keys);
}

/** Прочитать бинарь уже проверенного и авторизованного вызывающим кода файла. */
export async function readAssetBytes(
  rt: Runtime,
  asset: Pick<PrismaAsset, "storageKey">,
): Promise<ArrayBuffer> {
  try {
    const bytes = await readFile(join(filesDir(rt.env), asset.storageKey));
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  } catch (err) {
    if (isFileNotFound(err)) {
      throw new HttpError(404, "not_found", "Файл не найден");
    }
    throw err;
  }
}

// --- внутреннее ---

/** Абсолютный путь к каталогу хранения. */
function filesDir(env: Env): string {
  return resolve(env.FILES_DIR);
}

/** Обезличенное имя файла (hex). */
function randomName(): string {
  return randomBytes(16).toString("hex");
}

/** Ключ хранения с подпапкой-шардом по первым двум символам имени. */
function shardKey(name: string, ext: string): string {
  return `${name.slice(0, 2)}/${name}.${ext}`;
}

function scopedKey(prefix: string, key: string): string {
  return prefix ? `${prefix}/${key}` : key;
}

/**
 * Записать оригинал под обезличенным именем и вернуть это имя. Флаг `wx` не даёт
 * перезаписать существующий файл, поэтому коллизия имён (практически невозможная
 * на 128 битах) приводит не к потере чужих данных, а к повтору с новым именем.
 */
async function writeOriginalUnique(
  dir: string,
  prefix: string,
  ext: string,
  data: Uint8Array,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const name = randomName();
    try {
      await writeBinary(dir, scopedKey(prefix, shardKey(name, ext)), data);
      return name;
    } catch (err) {
      if (isFileExists(err) && attempt < 4) continue;
      throw err;
    }
  }
}

/**
 * WebP-производные под `srcset` (решение №7) для каждой целевой ширины без
 * апскейла. Сбой sharp на «валидном по сигнатуре, но битом» изображении отдаём
 * осмысленным 422, а не голым 500.
 */
async function renderImageVariants(
  bytes: Uint8Array,
): Promise<{ width: number; bytes: Buffer }[]> {
  try {
    const meta = await sharp(Buffer.from(bytes)).metadata();
    const variants: { width: number; bytes: Buffer }[] = [];
    for (const width of imageVariantTargets(meta.width)) {
      variants.push({ width, bytes: await toWebp(bytes, width) });
    }
    return variants;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(
      422,
      "image_processing_failed",
      "Не удалось обработать изображение",
    );
  }
}

/** Записать бинарь по ключу, создав подпапки. `wx` — не перезаписывать чужой файл. */
async function writeBinary(
  dir: string,
  key: string,
  data: Uint8Array,
): Promise<void> {
  const full = join(dir, key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data, { flag: "wx" });
}

/** `true`, если ошибка — попытка записи поверх существующего файла. */
function isFileExists(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "EEXIST"
  );
}

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Удалить файлы по ключам, не падая на отсутствующих (`force`). Реальные сбои
 * удаления (права, гонки) логируем: иначе сирота останется молча — а решение №4
 * обещает подчистку в той же операции.
 */
async function cleanupKeys(dir: string, keys: string[]): Promise<void> {
  const results = await Promise.allSettled(
    keys.map((key) => rm(join(dir, key), { force: true })),
  );
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`[files] не удалось удалить ${keys[i]}:`, result.reason);
    }
  });
}

/** Безопасное исходное имя для метаданных (без пути, ограниченной длины). */
function sanitizeOriginalName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "file";
  return base.slice(0, 255);
}
