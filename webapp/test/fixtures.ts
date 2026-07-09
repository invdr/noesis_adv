import {
  type Contact,
  type ContactDetail,
  type Lead,
  type LeadAgendaResponse,
  type LeadDetail,
  type SessionUser,
} from "@noesis/contracts";

// --- CRM: пользователи, заявки, повестка, контакты ---

export function sessionUser(role: "admin" | "manager" = "manager", over: Partial<SessionUser> = {}): SessionUser {
  return {
    id: role === "admin" ? "admin1" : "m1",
    email: `${role}@gsk.ru`,
    name: role === "admin" ? "Админ" : "Мария Менеджер",
    role,
    mustChangePassword: false,
    ...over,
  };
}

export function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "lead1",
    name: "Иван Петров",
    phone: "+79280000000",
    source: "hero_form",
    sourceName: "Главная форма",
    stageId: "s_new",
    stage: { id: "s_new", name: "Новая", kind: "in_progress", funnelId: "f1" },
    constructionId: "p1",
    constructionName: "СФ-001",
    message: null,
    contactId: "c1",
    contactName: "Иван Петров",
    referrerId: null,
    assigneeId: null,
    isRepeat: false,
    nextContactAt: null,
    nextContactTypeId: null,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...over,
  };
}

export function leadDetail(over: Partial<LeadDetail> = {}): LeadDetail {
  return {
    ...lead(),
    notes: [],
    statusHistory: [
      {
        id: "se1",
        stage: { id: "s_new", name: "Новая", kind: "in_progress", funnelId: "f1" },
        authorId: null,
        authorEmail: null,
        createdAt: "2026-07-01T10:00:00.000Z",
      },
    ],
    assignHistory: [
      {
        id: "ae1",
        assigneeId: "m1",
        assigneeLabel: "Мария Менеджер",
        authorId: "admin1",
        authorEmail: "admin@gsk.ru",
        createdAt: "2026-07-01T11:00:00.000Z",
      },
    ],
    contactHistory: [
      {
        id: "ce1",
        kind: "done",
        at: "2026-07-02T12:00:00.000Z",
        typeName: "Звонок",
        authorId: "m1",
        authorEmail: "manager@gsk.ru",
        createdAt: "2026-07-02T12:05:00.000Z",
      },
    ],
    related: [],
    referrer: null,
    ...over,
  };
}

export function agendaResponse(over: Partial<LeadAgendaResponse> = {}): LeadAgendaResponse {
  const item = (id: string, at: string | null) => ({
    id,
    name: `Клиент ${id}`,
    phone: "+79280000000",
    stageName: "В работе",
    nextContactAt: at,
    nextContactTypeName: "Звонок",
  });
  return {
    overdue: [item("over1", "2026-07-01T10:00:00.000Z")],
    today: [item("today1", new Date().toISOString())],
    upcoming: [],
    noTask: [{ ...item("lost1", null), nextContactTypeName: null }],
    ...over,
  };
}

export function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    kind: "client",
    fullName: "Иван Петров",
    phone: "+79280000000",
    companyName: null,
    agencyId: null,
    agencyName: null,
    createdById: null,
    note: null,
    birthDate: null,
    birthPlace: null,
    passportSeries: null,
    passportNumber: null,
    passportIssuedBy: null,
    passportIssuedAt: null,
    passportDepartmentCode: null,
    registrationAddress: null,
    actualAddress: null,
    lastInteractionAt: null,
    leadsCount: 2,
    referredCount: 0,
    lastLeadId: "lead1",
    lastLeadAt: "2026-07-01T10:00:00.000Z",
    lastStage: { id: "s_new", name: "Новая", kind: "in_progress", funnelId: "f1" },
    lastSource: "hero_form",
    lastSourceName: "Главная форма",
    assigneeId: null,
    isArchived: false,
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    ...over,
  };
}

export function contactDetail(over: Partial<ContactDetail> = {}): ContactDetail {
  return {
    ...contact(),
    leads: [
      {
        id: "lead1",
        name: "Иван Петров",
        createdAt: "2026-07-01T10:00:00.000Z",
        stage: { id: "s_new", name: "Новая", kind: "in_progress", funnelId: "f1" },
        source: "hero_form",
        sourceName: "Главная форма",
        projectName: "СФ-001",
        assigneeId: null,
      },
    ],
    referredLeads: [],
    ...over,
  };
}
