import type {
  Contact as PrismaContact,
  Lead as PrismaLead,
  LeadNote as PrismaLeadNote,
  LeadStatusEvent as PrismaLeadStatusEvent,
  Stage as PrismaStage,
  User as PrismaUser,
} from "@prisma/client";
import type {
  Lead,
  LeadAssignEvent,
  LeadContactEvent,
  LeadDetail,
  LeadNote,
  LeadReferrerRef,
  LeadStatusEvent,
  LeadStageRef,
} from "@noesis/contracts";
import type {
  LeadAssignEvent as PrismaLeadAssignEvent,
  LeadContactEvent as PrismaLeadContactEvent,
} from "@prisma/client";
import {
  toDealBookingSummary,
  toDealDocumentDto,
  type DealBookingRow,
  type DealDocumentRow,
} from "./deal-dto";

/** Минимум полей этапа, нужный DTO заявки. */
type StageRefRow = Pick<PrismaStage, "id" | "name" | "kind" | "funnelId">;
/** Строка заявки вместе с этапом и (опционально) названиями конструкции/источника. */
export type LeadRow = PrismaLead & {
  stage: StageRefRow;
  construction?: { name: string } | null;
  sourceOption?: { name: string } | null;
  contact?: { fullName: string } | null;
};
/** Заметка вместе с автором (для email). */
export type LeadNoteRow = PrismaLeadNote & { author: Pick<PrismaUser, "email"> };
/** Событие истории вместе с этапом и (опционально) автором. */
export type LeadStatusEventRow = PrismaLeadStatusEvent & {
  stage: StageRefRow;
  author: Pick<PrismaUser, "email"> | null;
};
/** Минимум полей реферера-партнёра для карточки. */
export type ReferrerRefRow = Pick<PrismaContact, "id" | "fullName" | "kind">;
/** Событие назначения вместе с адресатом и автором (для подписей). */
export type LeadAssignEventRow = PrismaLeadAssignEvent & {
  assignee: Pick<PrismaUser, "name" | "email"> | null;
  author: Pick<PrismaUser, "email"> | null;
};
/** Событие задачи «следующий контакт» вместе с автором. */
export type LeadContactEventRow = PrismaLeadContactEvent & {
  author: Pick<PrismaUser, "email"> | null;
};

function toReferrerRef(row: ReferrerRefRow): LeadReferrerRef {
  return { id: row.id, fullName: row.fullName, kind: row.kind };
}

function toStageRef(stage: StageRefRow): LeadStageRef {
  return {
    id: stage.id,
    name: stage.name,
    kind: stage.kind,
    funnelId: stage.funnelId,
  };
}

/** Маппинг строки БД в DTO заявки контракта (даты → ISO-строки). */
export function toLeadDto(lead: LeadRow): Lead {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    source: lead.source,
    sourceName: lead.sourceOption?.name ?? null,
    stageId: lead.stageId,
    stage: toStageRef(lead.stage),
    constructionId: lead.constructionId,
    constructionName: lead.construction?.name ?? null,
    message: lead.message,
    contactId: lead.contactId,
    contactName: lead.contact?.fullName ?? null,
    referrerId: lead.referrerId,
    assigneeId: lead.assigneeId,
    isRepeat: lead.isRepeat,
    nextContactAt: lead.nextContactAt ? lead.nextContactAt.toISOString() : null,
    nextContactTypeId: lead.nextContactTypeId,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

export function toLeadNoteDto(note: LeadNoteRow): LeadNote {
  return {
    id: note.id,
    text: note.text,
    authorId: note.authorId,
    authorEmail: note.author.email,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export function toLeadStatusEventDto(
  event: LeadStatusEventRow,
): LeadStatusEvent {
  return {
    id: event.id,
    stage: toStageRef(event.stage),
    authorId: event.authorId,
    authorEmail: event.author?.email ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

export function toLeadAssignEventDto(event: LeadAssignEventRow): LeadAssignEvent {
  return {
    id: event.id,
    assigneeId: event.assigneeId,
    // Адресат мог быть удалён (SetNull) — тогда подписи нет, фронт покажет
    // обезличенное «менеджер».
    assigneeLabel: event.assignee
      ? event.assignee.name || event.assignee.email
      : null,
    authorId: event.authorId,
    authorEmail: event.author?.email ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

export function toLeadContactEventDto(event: LeadContactEventRow): LeadContactEvent {
  return {
    id: event.id,
    kind: event.kind as LeadContactEvent["kind"],
    at: event.at ? event.at.toISOString() : null,
    typeName: event.typeName,
    authorId: event.authorId,
    authorEmail: event.author?.email ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

/** Сборка полной карточки: заявка + заметки + истории + связанные + реферер + сделка. */
export function toLeadDetailDto(args: {
  lead: LeadRow;
  notes: LeadNoteRow[];
  statusHistory: LeadStatusEventRow[];
  assignHistory: LeadAssignEventRow[];
  contactHistory: LeadContactEventRow[];
  related: LeadRow[];
  referrer: ReferrerRefRow | null;
  bookings: DealBookingRow[];
  dealDocuments: DealDocumentRow[];
  canAccessDealDocuments: boolean;
}): LeadDetail {
  return {
    ...toLeadDto(args.lead),
    notes: args.notes.map(toLeadNoteDto),
    statusHistory: args.statusHistory.map(toLeadStatusEventDto),
    assignHistory: args.assignHistory.map(toLeadAssignEventDto),
    contactHistory: args.contactHistory.map(toLeadContactEventDto),
    related: args.related.map(toLeadDto),
    referrer: args.referrer ? toReferrerRef(args.referrer) : null,
    bookings: args.bookings.map(toDealBookingSummary),
    dealDocuments: args.dealDocuments.map(toDealDocumentDto),
    dealNoDocuments: args.canAccessDealDocuments ? args.lead.dealNoDocuments : false,
  };
}
