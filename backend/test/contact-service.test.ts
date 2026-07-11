import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import {
  createContact,
  deleteContact,
  findOrCreateClientByPhone,
  listContacts,
  updateContact,
} from "../src/contacts/contact-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const admin = { id: "admin", email: "a@gsk.ru", role: "admin" } as unknown as SessionUser;
const manager = { id: "m1", email: "m@gsk.ru", role: "manager" } as unknown as SessionUser;
const stage = { id: "s1", name: "Новая", kind: "in_progress" as const, funnelId: "f1" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    type: "individual",
    isClient: true,
    isPartner: false,
    fullName: "Иван",
    phone: "+79990000000",
    organizationId: null,
    organization: null,
    createdById: "admin",
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
    legalName: null,
    inn: null,
    kpp: null,
    ogrn: null,
    legalAddress: null,
    postalAddress: null,
    bankName: null,
    bankBik: null,
    bankAccount: null,
    correspondentAccount: null,
    directorTitle: null,
    directorFullName: null,
    directorBasis: null,
    lastInteractionAt: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function aggregatePrisma(extra: Record<string, unknown> = {}) {
  return {
    lead: {
      count: async () => 0,
      findFirst: async () => null,
      findMany: async () => [],
      ...(extra.lead as object),
    },
    ...extra,
  };
}

describe("findOrCreateClientByPhone", () => {
  test("находит существующего клиента по роли и телефону", async () => {
    let where: unknown;
    const tx = { contact: { findFirst: async (args: any) => { where = args.where; return { id: "old", archivedAt: null }; } } };
    expect(await findOrCreateClientByPhone(tx as any, "+79990000000", "Иван")).toBe("old");
    expect(where).toMatchObject({ isClient: true, phone: "+79990000000" });
  });

  test("создаёт человека-клиента", async () => {
    let data: unknown;
    const tx = { contact: { findFirst: async () => null, create: async (args: any) => { data = args.data; return { id: "new" }; } } };
    expect(await findOrCreateClientByPhone(tx as any, "+79990000000", "Иван")).toBe("new");
    expect(data).toMatchObject({ type: "individual", isClient: true, isPartner: false });
  });
});

describe("контрагенты и реквизиты", () => {
  test("создаёт компанию-партнёра с юридическими реквизитами", async () => {
    let created: any;
    const prisma = aggregatePrisma({
      contact: {
        findFirst: async () => null,
        create: async ({ data }: any) => { created = data; return row({ ...data, id: "co", type: "company", isClient: false, isPartner: true, organization: null }); },
      },
    });
    const contact = await createContact(runtimeWith(prisma), admin, {
      type: "company", isClient: false, isPartner: true, fullName: "Строймедиа", legalName: "ООО «Строймедиа»", inn: "1234567890", bankBik: "044525225",
    });
    expect(created).toMatchObject({ type: "company", isClient: false, isPartner: true, legalName: "ООО «Строймедиа»", inn: "1234567890" });
    expect(contact.legalName).toBe("ООО «Строймедиа»");
  });

  test("разрешает человеку одновременно быть клиентом и партнёром", async () => {
    let created: any;
    const prisma = aggregatePrisma({
      contact: {
        findFirst: async () => null,
        findUnique: async () => row({ id: "co", type: "company", isClient: false, isPartner: true, fullName: "Компания" }),
        create: async ({ data }: any) => { created = data; return row({ ...data, organization: { fullName: "Компания" } }); },
      },
    });
    await createContact(runtimeWith(prisma), admin, {
      type: "individual", isClient: true, isPartner: true, fullName: "Иван", phone: "+79990000000", organizationId: "co",
    });
    expect(created).toMatchObject({ isClient: true, isPartner: true, organizationId: "co" });
  });

  test("не даёт назначить компанию представителю, который не является партнёром", async () => {
    const prisma = aggregatePrisma({ contact: { findFirst: async () => null } });
    await expect(createContact(runtimeWith(prisma), admin, {
      type: "individual", isClient: true, isPartner: false, fullName: "Иван", phone: "+79990000000", organizationId: "co",
    })).rejects.toMatchObject({ code: "organization_not_allowed" });
  });

  test("не даёт снять роль клиента, пока есть его заявки", async () => {
    const current = row({ isClient: true, isPartner: true });
    const prisma = aggregatePrisma({
      contact: { findUnique: async () => current },
      lead: { count: async () => 1, findFirst: async () => null, findMany: async () => [] },
    });
    await expect(updateContact(runtimeWith(prisma), admin, "c1", {
      type: "individual", isClient: false, isPartner: true, fullName: "Иван",
    })).rejects.toMatchObject({ code: "client_role_in_use" });
  });

  test("не даёт превратить используемую компанию в человека", async () => {
    const current = row({ type: "company", isClient: false, isPartner: true });
    const prisma = aggregatePrisma({
      contact: { findUnique: async () => current, count: async () => 2 },
      lead: { count: async () => 0, findFirst: async () => null, findMany: async () => [] },
    });
    await expect(updateContact(runtimeWith(prisma), admin, "c1", {
      type: "individual", isClient: false, isPartner: true, fullName: "Иван",
    })).rejects.toMatchObject({ code: "company_in_use" });
  });
});

describe("listContacts", () => {
  test("фильтрует роли независимо от вида контрагента", async () => {
    let where: any;
    const prisma = aggregatePrisma({ contact: { findMany: async (args: any) => { where = args.where; return []; } } });
    await listContacts(runtimeWith(prisma), admin, { type: "company", role: "partner" });
    expect(JSON.stringify(where)).toContain("isPartner");
    expect(JSON.stringify(where)).toContain("company");
  });

  test("менеджер видит партнёров и доступных ему клиентов", async () => {
    let where: any;
    const prisma = aggregatePrisma({ contact: { findMany: async (args: any) => { where = args.where; return []; } } });
    await listContacts(runtimeWith(prisma), manager, {});
    expect(JSON.stringify(where)).toContain("isPartner");
    expect(JSON.stringify(where)).toContain("createdById");
  });
});

describe("deleteContact", () => {
  test("не удаляет компанию с представителями", async () => {
    const prisma = {
      contact: { findUnique: async () => row({ type: "company" }), count: async () => 1 },
      lead: { count: async () => 0 },
    };
    await expect(deleteContact(runtimeWith(prisma), "c1")).rejects.toMatchObject({ code: "company_in_use" });
  });
});
