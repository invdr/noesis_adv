import { z } from "zod";

/** Публичные агрегаты для hero главной страницы. */
export const publicSiteStatsSchema = z.object({
  developerCount: z.number().int().nonnegative(),
});
export type PublicSiteStats = z.infer<typeof publicSiteStatsSchema>;
