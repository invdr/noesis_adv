import { Hono } from "hono";
import { EMPTY_PROJECT_TOOLS, type Badge } from "@noesis/contracts";
import type { Asset as PrismaAsset, Construction } from "@prisma/client";
import type { Runtime } from "../runtime";
import type { AppEnv } from "../http/context";
import { HttpError } from "../http/errors";
import { toAssetDto } from "../files/file-dto";

/**
 * УНАСЛЕДОВАННЫЙ публичный контракт каталога (ЖК-форма) для плейсхолдер-лендинга
 * (недвижимость). Отдаёт конструкции в старой форме карточки, чтобы сайт
 * собирался без правок до Этапа 5 (редизайн). Удаляется вместе с ЖК-вёрсткой.
 */
function toLegacyCard(
  c: Construction & { cover: PrismaAsset | null },
  publicBase: string,
) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    address: c.address,
    priceFrom: null,
    rooms: [] as string[],
    description: c.description,
    cover: c.cover ? toAssetDto(c.cover, { publicBase }) : undefined,
    comingSoon: false,
    badges: (c.badges as Badge[] | null) ?? [],
    tools: EMPTY_PROJECT_TOOLS,
  };
}

export function legacySiteRoutes(rt: Runtime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const base = rt.env.FILES_PUBLIC_BASE;

  app.get("/", async (c) => {
    const rows = await rt.prisma.construction.findMany({
      where: { status: "published", archivedAt: null },
      include: { cover: true },
      orderBy: { createdAt: "asc" },
    });
    return c.json(rows.map((r) => toLegacyCard(r, base)));
  });

  app.get("/:slug", async (c) => {
    const row = await rt.prisma.construction.findFirst({
      where: { slug: c.req.param("slug"), status: "published", archivedAt: null },
      include: { cover: true },
    });
    if (!row) throw new HttpError(404, "not_found", "Не найдено");
    return c.json(toLegacyCard(row, base));
  });

  return app;
}
