import type { Stage as PrismaStage } from "@prisma/client";
import type { Stage, StageColor } from "@noesis/contracts";

/** Маппинг строки БД в DTO контракта (даты → ISO; archivedAt → isArchived). */
export function toStageDto(stage: PrismaStage): Stage {
  return {
    id: stage.id,
    name: stage.name,
    funnelId: stage.funnelId,
    order: stage.order,
    kind: stage.kind,
    // В БД цвет хранится строкой; токен валидируется на входе контрактом.
    color: stage.color as StageColor,
    isEntry: stage.isEntry,
    isArchived: stage.archivedAt !== null,
    createdAt: stage.createdAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString(),
  };
}
