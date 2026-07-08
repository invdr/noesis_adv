import type { PublicSiteStats } from "@noesis/contracts";
import type { Runtime } from "../runtime";

/** Публичные агрегаты для hero главной страницы. */
export async function getPublicSiteStats(rt: Runtime): Promise<PublicSiteStats> {
  const developerCount = await rt.prisma.developer.count({
    where: { archivedAt: null },
  });

  return { developerCount };
}
