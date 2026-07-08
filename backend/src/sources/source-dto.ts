import type { LeadSource as PrismaLeadSource } from "@prisma/client";
import type { LeadSourceOption } from "@gsk-tower/contracts";

/** Маппинг строки справочника источников в DTO контракта. */
export function toLeadSourceDto(row: PrismaLeadSource): LeadSourceOption {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    isSystem: row.isSystem,
    isWeb: row.isWeb,
    isArchived: row.archivedAt !== null,
  };
}
