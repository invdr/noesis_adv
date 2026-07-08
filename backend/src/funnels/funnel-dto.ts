import type { Funnel as PrismaFunnel } from "@prisma/client";
import type { Funnel } from "@gsk-tower/contracts";

/** Маппинг строки БД в DTO воронки (даты → ISO; archivedAt → isArchived). */
export function toFunnelDto(funnel: PrismaFunnel, stageCount: number): Funnel {
  return {
    id: funnel.id,
    name: funnel.name,
    order: funnel.order,
    isDefault: funnel.isDefault,
    isArchived: funnel.archivedAt !== null,
    stageCount,
    createdAt: funnel.createdAt.toISOString(),
    updatedAt: funnel.updatedAt.toISOString(),
  };
}
