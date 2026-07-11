import { describe, expect, test } from "bun:test";
import { leadSchema, leadDetailSchema } from "@noesis/contracts";
import {
  toLeadDetailDto,
  toLeadDto,
  type LeadAssignEventRow,
  type LeadContactEventRow,
  type LeadNoteRow,
  type LeadRow,
  type LeadStatusEventRow,
} from "../src/leads/lead-dto";

const now = new Date("2026-06-25T10:00:00.000Z");
const stage = {
  id: "stage_new",
  name: "Новая",
  kind: "in_progress" as const,
  funnelId: "funnel_default",
};

const baseLead: LeadRow = {
  id: "abc123",
  name: "Иван",
  phone: "+79280009300",
  source: "hero_form",
  stageId: "stage_new",
  stage,
  constructionId: null,
  message: null,
  contactId: null,
  referrerId: null,
  assigneeId: null,
  isRepeat: false,
  nextContactAt: null,
  nextContactTypeId: null,
  consentAt: now,
  consentIp: "203.0.113.7",
  dealNoDocuments: false,
  createdAt: now,
  updatedAt: now,
};

describe("toLeadDto", () => {
  test("маппит строку БД в валидный DTO контракта", () => {
    const dto = toLeadDto(baseLead);
    expect(() => leadSchema.parse(dto)).not.toThrow();
    expect(dto.createdAt).toBe("2026-06-25T10:00:00.000Z");
    expect(dto.stage.kind).toBe("in_progress");
    expect(dto.nextContactAt).toBeNull();
    // Поля согласия (IP/время) не утекают в DTO.
    expect("consentIp" in dto).toBe(false);
  });

  test("дата следующего контакта сериализуется в ISO", () => {
    const dto = toLeadDto({ ...baseLead, nextContactAt: now });
    expect(dto.nextContactAt).toBe("2026-06-25T10:00:00.000Z");
  });
});

describe("toLeadDetailDto", () => {
  test("собирает карточку с заметками, историей и связанными", () => {
    const note: LeadNoteRow = {
      id: "n1",
      leadId: "abc123",
      authorId: "u1",
      author: { email: "manager@noesis-grozny.ru" },
      text: "Перезвонить",
      createdAt: now,
      updatedAt: now,
    };
    const event: LeadStatusEventRow = {
      id: "e1",
      leadId: "abc123",
      stageId: "stage_new",
      stage,
      authorId: null,
      author: null,
      createdAt: now,
    };
    const assign: LeadAssignEventRow = {
      id: "a1",
      leadId: "abc123",
      assigneeId: "u2",
      assignee: { name: "Иван Менеджер", email: "ivan@noesis-grozny.ru" },
      authorId: "u1",
      author: { email: "admin@noesis-grozny.ru" },
      createdAt: now,
    };
    const contact: LeadContactEventRow = {
      id: "ce1",
      leadId: "abc123",
      kind: "scheduled",
      at: now,
      typeName: "Звонок",
      authorId: "u1",
      author: { email: "manager@noesis-grozny.ru" },
      createdAt: now,
    };
    const dto = toLeadDetailDto({
      lead: baseLead,
      notes: [note],
      statusHistory: [event],
      assignHistory: [assign],
      contactHistory: [contact],
      related: [{ ...baseLead, id: "rel1" }],
      referrer: { id: "c_partner", fullName: "Пётр", type: "individual" },
      bookings: [],
      dealDocuments: [],
      canAccessDealDocuments: true,
    });
    expect(() => leadDetailSchema.parse(dto)).not.toThrow();
    expect(dto.notes[0]?.authorEmail).toBe("manager@noesis-grozny.ru");
    expect(dto.statusHistory[0]?.authorEmail).toBeNull();
    expect(dto.assignHistory[0]?.assigneeLabel).toBe("Иван Менеджер");
    expect(dto.assignHistory[0]?.authorEmail).toBe("admin@noesis-grozny.ru");
    expect(dto.contactHistory[0]?.typeName).toBe("Звонок");
    expect(dto.contactHistory[0]?.at).toBe("2026-06-25T10:00:00.000Z");
    expect(dto.related[0]?.id).toBe("rel1");
    expect(dto.referrer?.fullName).toBe("Пётр");
    expect(dto.referrer?.type).toBe("individual");
  });
});
