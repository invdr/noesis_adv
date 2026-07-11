import type {
  Contact as PrismaContact,
  Lead as PrismaLead,
  Stage as PrismaStage,
} from "@prisma/client";
import type { Contact, LeadStageRef } from "@noesis/contracts";

/** Минимум полей этапа для DTO контакта (последняя заявка клиента). */
type StageRefRow = Pick<PrismaStage, "id" | "name" | "kind" | "funnelId">;
/** Строка контрагента с представляющей компанией. */
export type ContactRow = PrismaContact & {
  organization: Pick<PrismaContact, "fullName"> | null;
};
/** Свежайшая видимая заявка-покупатель контакта (для lastStage/lastSource). */
export type LatestLeadRow =
  | (Pick<PrismaLead, "id" | "createdAt" | "source" | "assigneeId"> & {
      stage: StageRefRow;
      sourceOption?: { name: string } | null;
    })
  | undefined;

/** Агрегаты по заявкам контакта, посчитанные в сервисе (с учётом видимости). */
export interface ContactAggregates {
  leadsCount: number;
  referredCount: number;
  latestLead: LatestLeadRow;
}

function toStageRef(stage: StageRefRow): LeadStageRef {
  return { id: stage.id, name: stage.name, kind: stage.kind, funnelId: stage.funnelId };
}

/** Prisma-строка контакта + агрегаты → DTO контракта. */
export function toContactDto(row: ContactRow, agg: ContactAggregates): Contact {
  const last = agg.latestLead;
  return {
    id: row.id,
    type: row.type,
    isClient: row.isClient,
    isPartner: row.isPartner,
    fullName: row.fullName,
    phone: row.phone,
    organizationId: row.organizationId,
    organizationName: row.organization?.fullName ?? null,
    createdById: row.createdById,
    note: row.note,
    birthDate: row.birthDate ?? null,
    birthPlace: row.birthPlace ?? null,
    passportSeries: row.passportSeries ?? null,
    passportNumber: row.passportNumber ?? null,
    passportIssuedBy: row.passportIssuedBy ?? null,
    passportIssuedAt: row.passportIssuedAt ?? null,
    passportDepartmentCode: row.passportDepartmentCode ?? null,
    registrationAddress: row.registrationAddress ?? null,
    actualAddress: row.actualAddress ?? null,
    legalName: row.legalName ?? null,
    inn: row.inn ?? null,
    kpp: row.kpp ?? null,
    ogrn: row.ogrn ?? null,
    legalAddress: row.legalAddress ?? null,
    postalAddress: row.postalAddress ?? null,
    bankName: row.bankName ?? null,
    bankBik: row.bankBik ?? null,
    bankAccount: row.bankAccount ?? null,
    correspondentAccount: row.correspondentAccount ?? null,
    directorTitle: row.directorTitle ?? null,
    directorFullName: row.directorFullName ?? null,
    directorBasis: row.directorBasis ?? null,
    lastInteractionAt: row.lastInteractionAt ? row.lastInteractionAt.toISOString() : null,
    leadsCount: agg.leadsCount,
    referredCount: agg.referredCount,
    lastLeadId: last ? last.id : null,
    lastLeadAt: last ? last.createdAt.toISOString() : null,
    lastStage: last ? toStageRef(last.stage) : null,
    lastSource: last ? last.source : null,
    lastSourceName: last ? last.sourceOption?.name ?? null : null,
    assigneeId: last ? last.assigneeId : null,
    isArchived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
