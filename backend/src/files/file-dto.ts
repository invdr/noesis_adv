import type { Asset as PrismaAsset } from "@prisma/client";
import type { Asset, ImageVariant } from "@gsk-tower/contracts";

/** Одна производная картинки на диске: ширина + ключ хранения (WebP). */
export interface StoredRendition {
  width: number;
  key: string;
}

/** Что нужно DTO для построения публичных ссылок. */
export interface AssetUrlConfig {
  /** Публичный префикс раздачи файлов (`FILES_PUBLIC_BASE`). */
  publicBase: string;
}

/** Публичная ссылка на файл по его ключу хранения. */
function publicUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key}`;
}

/**
 * Маппинг строки БД в DTO контракта: строит публичные URL из `storageKey`, а
 * для изображений — производные под `srcset` (по возрастанию ширины) с готовой
 * строкой `srcset` и тумбой.
 */
export function toAssetDto(asset: PrismaAsset, cfg: AssetUrlConfig): Asset {
  const dto: Asset = {
    id: asset.id,
    kind: asset.kind,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.size,
    url: publicUrl(cfg.publicBase, asset.storageKey),
    createdAt: asset.createdAt.toISOString(),
  };

  if (asset.kind === "image") {
    const stored = (asset.renditions as StoredRendition[] | null) ?? [];
    const variants: ImageVariant[] = stored
      .slice()
      .sort((a, b) => a.width - b.width)
      .map((r) => ({ width: r.width, url: publicUrl(cfg.publicBase, r.key) }));
    if (variants.length > 0) {
      dto.renditions = {
        variants,
        srcset: variants.map((v) => `${v.url} ${v.width}w`).join(", "),
        thumbnailUrl: variants[0]!.url,
      };
    }
  }

  return dto;
}
