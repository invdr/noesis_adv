import type { SiteBuild } from "@prisma/client";
import type { SiteBuildStatus } from "@noesis/contracts";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Prisma-строка состояния сборки → DTO статуса для CRM. */
export function toSiteBuildStatus(row: SiteBuild): SiteBuildStatus {
  return {
    status: row.status,
    unpublished: row.unpublishedSince !== null,
    unpublishedSince: iso(row.unpublishedSince),
    pending: row.pendingSince !== null,
    pendingSince: iso(row.pendingSince),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastBuildAt: iso(row.lastBuildAt),
    // Текст ошибки показываем только пока статус «упало».
    lastError: row.status === "failed" ? row.lastError : null,
  };
}
