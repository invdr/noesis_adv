import type { ContactType as PrismaContactType } from "@prisma/client";
import type { ContactType } from "@noesis/contracts";

/** Маппинг строки БД в DTO типа контакта (archivedAt → isArchived). */
export function toContactTypeDto(ct: PrismaContactType): ContactType {
  return {
    id: ct.id,
    name: ct.name,
    order: ct.order,
    isArchived: ct.archivedAt !== null,
  };
}
