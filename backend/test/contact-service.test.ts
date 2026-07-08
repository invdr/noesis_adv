import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import {
  archiveContact,
  createContact,
  deleteContact,
  findOrCreateClientByPhone,
  listContacts,
  restoreContact,
  updateContact,
} from "../src/contacts/contact-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const admin = { id: "admin", email: "a@gsk.ru", role: "admin" } as unknown as SessionUser;
const manager = { id: "m1", email: "m@gsk.ru", role: "manager" } as unknown as SessionUser;
const stage = { id: "s_new", name: "Новая", kind: "in_progress" as const, funnelId: "f1" };

describe("findOrCreateClientByPhone", () => {
  test("возвращает существующий контакт по телефону (без создания)", async () => {
    const tx = {
      contact: {
        findFirst: async () => ({ id: "c_exist" }),
        create: async () => {
          throw new Error("не должно создавать");
        },
      },
    };
    expect(await findOrCreateClientByPhone(tx as any, "+79280000000", "Иван")).toBe("c_exist");
  });

  test("возвращает архивного клиента и снимает archivedAt (возврат в работу)", async () => {
    let restoredId: string | undefined;
    const tx = {
      contact: {
        findFirst: async () => ({ id: "c_arch", archivedAt: new Date("2026-06-01T00:00:00Z") }),
        update: async ({ where }: any) => {
          restoredId = where.id;
          return { id: where.id };
        },
        create: async () => {
          throw new Error("не должно создавать");
        },
      },
    };
    expect(await findOrCreateClientByPhone(tx as any, "+79280000000", "Иван")).toBe("c_arch");
    expect(restoredId).toBe("c_arch");
  });

  test("создаёт контакт-клиента, если по телефону никого нет", async () => {
    let createdData: any;
    const tx = {
      contact: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          createdData = data;
          return { id: "c_new" };
        },
      },
    };
    expect(await findOrCreateClientByPhone(tx as any, "+79991112233", "Пётр")).toBe("c_new");
    expect(createdData).toMatchObject({ kind: "client", fullName: "Пётр", phone: "+79991112233" });
  });
});

describe("listContacts", () => {
  test("клиенту считает агрегаты заявок, партнёру — приведённые", async () => {
    const prisma = {
      contact: {
        findMany: async () => [
          {
            id: "c_client",
            kind: "client",
            fullName: "Иван",
            phone: "+79280000000",
            companyName: null,
            agencyId: null,
            agency: null,
            note: null,
            lastInteractionAt: null,
            archivedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { referredLeads: 0 },
          },
          {
            id: "c_realtor",
            kind: "realtor",
            fullName: "Пётр",
            phone: null,
            companyName: null,
            agencyId: "c_ag",
            agency: { fullName: "Этажи" },
            note: null,
            lastInteractionAt: null,
            archivedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { referredLeads: 5 },
          },
        ],
      },
      lead: {
        findMany: async () => [
          {
            contactId: "c_client",
            createdAt: new Date("2026-06-10T00:00:00Z"),
            source: "hero_form",
            assigneeId: null,
            stage,
          },
          {
            contactId: "c_client",
            createdAt: new Date("2026-05-01T00:00:00Z"),
            source: "project",
            assigneeId: null,
            stage,
          },
        ],
      },
    };
    const res = await listContacts(runtimeWith(prisma), admin, {});
    const client = res.find((c) => c.id === "c_client")!;
    const realtor = res.find((c) => c.id === "c_realtor")!;
    expect(client.leadsCount).toBe(2);
    expect(client.lastSource).toBe("hero_form"); // свежайшая заявка задаёт срез
    expect(client.lastStage?.name).toBe("Новая");
    expect(realtor.referredCount).toBe(5);
    expect(realtor.agencyName).toBe("Этажи");
    expect(realtor.leadsCount).toBe(0);
  });

  test("менеджеру фильтр видимости клиентов уходит в запрос", async () => {
    let whereArg: any;
    const prisma = {
      contact: {
        findMany: async ({ where }: any) => {
          whereArg = where;
          return [];
        },
      },
    };
    await listContacts(runtimeWith(prisma), manager, {});
    // AND содержит OR: партнёры всем + свои свободные клиенты + клиент через видимую заявку.
    const orClause = whereArg.AND.find((f: any) => Array.isArray(f.OR));
    expect(orClause).toBeTruthy();
    expect(JSON.stringify(orClause)).toContain("createdById");
    expect(JSON.stringify(orClause)).toContain("none");
    expect(JSON.stringify(orClause)).toContain("assigneeId");
  });
});

describe("createContact / updateContact — инварианты типа", () => {
  test("ручное создание клиента проходит, нормализует телефон и ставит автора", async () => {
    let createdData: any;
    const row = {
      id: "c_new",
      kind: "client",
      fullName: "Иван",
      phone: "+79280000000",
      companyName: null,
      agencyId: null,
      agency: null,
      createdById: "admin",
      note: null,
      lastInteractionAt: null,
      archivedAt: null,
      createdAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    };
    const prisma = {
      contact: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          createdData = data;
          return { ...row, phone: data.phone, createdById: data.createdById };
        },
      },
      lead: { count: async () => 0, findFirst: async () => null },
    };
    const res = await createContact(runtimeWith(prisma), admin, {
      kind: "client",
      fullName: "Иван",
      phone: "8 (928) 000-00-00",
    });
    expect(createdData).toMatchObject({
      kind: "client",
      phone: "+79280000000",
      createdById: "admin",
    });
    expect(res.phone).toBe("+79280000000");
    expect(res.createdById).toBe("admin");
  });

  test("дубль клиента по телефону отклоняется (409)", async () => {
    const prisma = {
      contact: { findFirst: async () => ({ id: "c_exist" }) },
    };
    await expect(
      createContact(runtimeWith(prisma), admin, {
        kind: "client",
        fullName: "Иван",
        phone: "+79280000000",
      }),
    ).rejects.toMatchObject({ status: 409, code: "duplicate_client_phone" });
  });

  test("скрытый дубль клиента по телефону не раскрывается менеджеру как duplicate → 404", async () => {
    const prisma = {
      contact: { findFirst: async () => ({ id: "hidden", createdById: "m2" }) },
      lead: { count: async () => 0 },
    };
    await expect(
      createContact(runtimeWith(prisma), manager, {
        kind: "client",
        fullName: "Иван",
        phone: "+79280000000",
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  test("свой бывший клиент с невидимыми заявками при дубле телефона тоже не раскрывается → 404", async () => {
    const prisma = {
      contact: { findFirst: async () => ({ id: "hidden", createdById: "m1" }) },
      lead: {
        count: async ({ where }: any) => (where?.AND ? 0 : 1),
      },
    };
    await expect(
      createContact(runtimeWith(prisma), manager, {
        kind: "client",
        fullName: "Иван",
        phone: "+79280000000",
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  test("повторное создание своего архивного свободного клиента восстанавливает запись", async () => {
    let updateData: any;
    const archived = {
      id: "c_arch",
      kind: "client",
      fullName: "Иван Старый",
      phone: "+79280000000",
      companyName: null,
      agencyId: null,
      agency: null,
      createdById: "m1",
      note: "old",
      lastInteractionAt: null,
      archivedAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    };
    const prisma = {
      contact: {
        findFirst: async ({ where }: any) => (where?.archivedAt ? archived : null),
        update: async ({ data }: any) => {
          updateData = data;
          return { ...archived, ...data, updatedAt: new Date("2026-06-02T00:00:00Z") };
        },
      },
      lead: { count: async () => 0, findFirst: async () => null },
    };
    const res = await createContact(runtimeWith(prisma), manager, {
      kind: "client",
      fullName: "Иван Новый",
      phone: "+79280000000",
      note: "вернулся",
    });
    expect(res.id).toBe("c_arch");
    expect(res.fullName).toBe("Иван Новый");
    expect(res.isArchived).toBe(false);
    expect(updateData).toMatchObject({
      fullName: "Иван Новый",
      note: "вернулся",
      archivedAt: null,
    });
  });

  test("архивный клиент не восстанавливается поверх активного дубля телефона", async () => {
    const archived = {
      id: "c_arch",
      kind: "client",
      fullName: "Иван Старый",
      phone: "+79280000000",
      companyName: null,
      agencyId: null,
      agency: null,
      createdById: "m1",
      note: null,
      lastInteractionAt: null,
      archivedAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    };
    const prisma = {
      contact: {
        findFirst: async ({ where }: any) =>
          where?.archivedAt ? archived : { id: "c_active", createdById: "m1" },
        update: async () => {
          throw new Error("не должно восстанавливать архивный дубль");
        },
      },
      lead: { count: async () => 0 },
    };
    await expect(
      createContact(runtimeWith(prisma), manager, {
        kind: "client",
        fullName: "Иван Новый",
        phone: "+79280000000",
      }),
    ).rejects.toMatchObject({ status: 409, code: "duplicate_client_phone" });
  });

  test("агентству нельзя указать agencyId (422)", async () => {
    const rt = runtimeWith({});
    await expect(
      createContact(rt, admin, { kind: "agency", fullName: "Этажи", agencyId: "x" }),
    ).rejects.toMatchObject({ status: 422, code: "agency_not_allowed" });
  });

  test("риелтор с несуществующим агентством (422)", async () => {
    const prisma = { contact: { findUnique: async () => null } };
    await expect(
      createContact(runtimeWith(prisma), admin, {
        kind: "realtor",
        fullName: "Пётр",
        agencyId: "ghost",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_agency" });
  });

  test("оптимистичная блокировка: несовпадение версии → 409", async () => {
    const prisma = {
      contact: {
        findUnique: async () => ({
          id: "c1",
          kind: "realtor",
          agencyId: null,
          archivedAt: null,
          updatedAt: new Date("2026-06-30T00:00:00Z"),
          agency: null,
        }),
      },
    };
    await expect(
      updateContact(runtimeWith(prisma), admin, "c1", {
        kind: "realtor",
        fullName: "Пётр",
        expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 409, code: "stale_update" });
  });

  test("агентство с привязанными риелторами нельзя сменить тип (409)", async () => {
    const prisma = {
      contact: {
        findUnique: async () => ({
          id: "ag",
          kind: "agency",
          agencyId: null,
          archivedAt: null,
          updatedAt: new Date("2026-06-30T00:00:00Z"),
          agency: null,
        }),
        count: async () => 2, // привязанные риелторы
      },
      lead: { count: async () => 0 },
    };
    await expect(
      updateContact(runtimeWith(prisma), admin, "ag", { kind: "realtor", fullName: "Этажи" }),
    ).rejects.toMatchObject({ status: 409, code: "agency_in_use" });
  });

  test("партнёра нельзя превратить в клиента сменой типа (422)", async () => {
    // Даже без рефералов: конвертация партнёр→клиент запрещена, чтобы не заводить
    // второго покупателя в обход телефонного дедупа и не оставлять сиротские связи.
    const prisma = {
      contact: {
        findUnique: async () => ({
          id: "r",
          kind: "realtor",
          agencyId: null,
          archivedAt: null,
          updatedAt: new Date("2026-06-30T00:00:00Z"),
          agency: null,
        }),
        count: async () => 0,
      },
      lead: { count: async () => 0 }, // рефералов нет — раньше проходило, теперь нет
    };
    await expect(
      updateContact(runtimeWith(prisma), admin, "r", { kind: "client", fullName: "Пётр" }),
    ).rejects.toMatchObject({ status: 422, code: "client_not_creatable" });
  });
});

describe("deleteContact", () => {
  test("используемый заявками контакт удалять нельзя (409)", async () => {
    const prisma = {
      contact: {
        findUnique: async () => ({ id: "c1", kind: "realtor", archivedAt: null, agency: null }),
        count: async () => 0,
      },
      lead: { count: async () => 3 },
    };
    await expect(deleteContact(runtimeWith(prisma), "c1")).rejects.toMatchObject({
      status: 409,
      code: "contact_in_use",
    });
  });
});

describe("archiveContact / resolveAgencyId — крайние случаи", () => {
  test("повторная архивация уже архивного контакта → 409 already_archived", async () => {
    const prisma = {
      contact: {
        findUnique: async () => ({
          id: "c1",
          kind: "realtor",
          archivedAt: new Date("2026-06-01T00:00:00Z"),
          agency: null,
        }),
      },
    };
    await expect(archiveContact(runtimeWith(prisma), admin, "c1")).rejects.toMatchObject({
      status: 409,
      code: "already_archived",
    });
  });

  test("риелтор не может быть своим агентством → 422 agency_self", async () => {
    const prisma = {
      contact: {
        findUnique: async () => ({
          id: "r1",
          kind: "realtor",
          agencyId: null,
          archivedAt: null,
          updatedAt: new Date("2026-06-30T00:00:00Z"),
          agency: null,
        }),
      },
    };
    await expect(
      updateContact(runtimeWith(prisma), admin, "r1", {
        kind: "realtor",
        fullName: "Пётр",
        agencyId: "r1", // ссылка на самого себя
      }),
    ).rejects.toMatchObject({ status: 422, code: "agency_self" });
  });

  test("правку риелтора с неизменным архивным agencyId пропускаем (не 422)", async () => {
    const archivedAgency = {
      id: "ag",
      kind: "agency",
      archivedAt: new Date("2026-06-01T00:00:00Z"),
    };
    const realtorRow = {
      id: "r1",
      kind: "realtor",
      fullName: "Пётр",
      phone: "+79280000000",
      companyName: null,
      agencyId: "ag", // привязан к агентству, которое позже архивировали
      agency: { fullName: "Этажи" },
      note: null,
      lastInteractionAt: null,
      archivedAt: null,
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-06-30T00:00:00Z"),
    };
    let updateData: any;
    const prisma = {
      contact: {
        findUnique: async ({ where }: any) =>
          where.id === "ag" ? archivedAgency : realtorRow,
        update: async ({ data }: any) => {
          updateData = data;
          return { ...realtorRow, fullName: data.fullName };
        },
      },
      lead: { count: async () => 0 },
    };
    const res = await updateContact(runtimeWith(prisma), admin, "r1", {
      kind: "realtor",
      fullName: "Пётр Обновлённый",
      agencyId: "ag", // тот же (архивный) agencyId — правим только имя
    });
    expect(res.fullName).toBe("Пётр Обновлённый");
    expect(updateData.agencyId).toBe("ag");
  });

  test("назначение ДРУГОГО архивного агентства по-прежнему → 422 invalid_agency", async () => {
    const otherArchived = {
      id: "ag_new",
      kind: "agency",
      archivedAt: new Date("2026-06-01T00:00:00Z"),
    };
    const realtorRow = {
      id: "r1",
      kind: "realtor",
      agencyId: "ag_old", // была привязка к другому агентству
      archivedAt: null,
      updatedAt: new Date("2026-06-30T00:00:00Z"),
      agency: null,
    };
    const prisma = {
      contact: {
        findUnique: async ({ where }: any) =>
          where.id === "ag_new" ? otherArchived : realtorRow,
      },
      lead: { count: async () => 0 },
    };
    await expect(
      updateContact(runtimeWith(prisma), admin, "r1", {
        kind: "realtor",
        fullName: "Пётр",
        agencyId: "ag_new", // другое агентство, к тому же архивное
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_agency" });
  });
});

describe("restoreContact", () => {
  test("снимает archivedAt и возвращает разархивированный контакт", async () => {
    const archivedRow = {
      id: "c1",
      kind: "realtor",
      fullName: "Пётр",
      phone: "+79280000000",
      companyName: null,
      agencyId: null,
      agency: null,
      note: null,
      lastInteractionAt: null,
      archivedAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-06-30T00:00:00Z"),
    };
    let updateData: any;
    const prisma = {
      contact: {
        findUnique: async () => archivedRow,
        update: async ({ data }: any) => {
          updateData = data;
          return { ...archivedRow, archivedAt: null };
        },
      },
      lead: { count: async () => 0 },
    };
    const res = await restoreContact(runtimeWith(prisma), admin, "c1");
    expect(updateData.archivedAt).toBeNull();
    expect(res.isArchived).toBe(false);
  });

  test("восстановление несуществующего контакта → 404", async () => {
    const prisma = { contact: { findUnique: async () => null } };
    await expect(restoreContact(runtimeWith(prisma), admin, "ghost")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  test("восстановление не-архивного контакта → 409 not_archived", async () => {
    const prisma = {
      contact: {
        findUnique: async () => ({ id: "c1", kind: "realtor", archivedAt: null, agency: null }),
      },
    };
    await expect(restoreContact(runtimeWith(prisma), admin, "c1")).rejects.toMatchObject({
      status: 409,
      code: "not_archived",
    });
  });
});

describe("видимость клиента при записи (guard)", () => {
  const clientRow = {
    id: "c1",
    kind: "client",
    fullName: "Иван",
    phone: "+79280000000",
    companyName: null,
    agencyId: null,
    agency: null,
    createdById: null,
    note: null,
    lastInteractionAt: null,
    archivedAt: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-06-30T00:00:00Z"),
  };

  test("менеджер без видимой заявки не может править клиента → 404", async () => {
    const prisma = {
      contact: { findUnique: async () => clientRow },
      lead: { count: async () => 0 }, // нет видимой заявки этого клиента
    };
    await expect(
      updateContact(runtimeWith(prisma), manager, "c1", { kind: "client", fullName: "Взлом" }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  test("менеджер правит своего свободного клиента без заявок — проходит", async () => {
    let updateData: any;
    const ownClient = { ...clientRow, createdById: "m1" };
    const prisma = {
      contact: {
        findUnique: async () => ownClient,
        findFirst: async () => null,
        update: async ({ data }: any) => {
          updateData = data;
          return { ...ownClient, fullName: data.fullName, phone: data.phone };
        },
      },
      lead: { count: async () => 0, findFirst: async () => null },
    };
    const res = await updateContact(runtimeWith(prisma), manager, "c1", {
      kind: "client",
      fullName: "Иван Свободный",
      phone: clientRow.phone,
    });
    expect(res.fullName).toBe("Иван Свободный");
    expect(updateData.fullName).toBe("Иван Свободный");
  });

  test("менеджер не видит своего созданного клиента после появления только чужих заявок → 404", async () => {
    const ownClient = { ...clientRow, createdById: "m1" };
    const prisma = {
      contact: { findUnique: async () => ownClient },
      lead: {
        count: async ({ where }: any) => (where?.AND ? 0 : 1),
      },
    };
    await expect(
      updateContact(runtimeWith(prisma), manager, "c1", {
        kind: "client",
        fullName: "Иван",
        phone: clientRow.phone,
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  test("менеджер без видимой заявки не может архивировать клиента → 404", async () => {
    const prisma = {
      contact: { findUnique: async () => clientRow },
      lead: { count: async () => 0 },
    };
    await expect(archiveContact(runtimeWith(prisma), manager, "c1")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  test("менеджер с видимой заявкой правит клиента — проходит", async () => {
    let updateData: any;
    const prisma = {
      contact: {
        findUnique: async () => clientRow,
        findFirst: async () => null,
        update: async ({ data }: any) => {
          updateData = data;
          return { ...clientRow, fullName: data.fullName, phone: data.phone };
        },
      },
      lead: { count: async () => 1, findFirst: async () => null }, // есть видимая заявка
    };
    const res = await updateContact(runtimeWith(prisma), manager, "c1", {
      kind: "client",
      fullName: "Иван Обновлённый",
      phone: clientRow.phone,
    });
    expect(res.fullName).toBe("Иван Обновлённый");
    expect(updateData.fullName).toBe("Иван Обновлённый");
  });

  test("клиента с заявками-покупателя нельзя превратить в партнёра → 409", async () => {
    const prisma = {
      contact: { findUnique: async () => clientRow },
      lead: { count: async () => 2 }, // есть заявки, где контакт — покупатель
    };
    await expect(
      updateContact(runtimeWith(prisma), admin, "c1", {
        kind: "realtor",
        fullName: "Пётр",
        phone: clientRow.phone,
      }),
    ).rejects.toMatchObject({ status: 409, code: "contact_in_use" });
  });

  test("телефон свободного клиента можно изменить, если нет дубля", async () => {
    let updateData: any;
    const ownClient = { ...clientRow, createdById: "m1" };
    const prisma = {
      contact: {
        findUnique: async () => ownClient,
        findFirst: async () => null,
        update: async ({ data }: any) => {
          updateData = data;
          return { ...ownClient, phone: data.phone };
        },
      },
      lead: { count: async () => 0, findFirst: async () => null },
    };
    const res = await updateContact(runtimeWith(prisma), manager, "c1", {
      kind: "client",
      fullName: "Иван",
      phone: "8 (999) 111-22-33",
    });
    expect(updateData.phone).toBe("+79991112233");
    expect(res.phone).toBe("+79991112233");
  });

  test("телефон клиента с заявками нельзя изменить → 422 client_phone_locked", async () => {
    const prisma = {
      contact: {
        findUnique: async () => clientRow,
      },
      lead: { count: async () => 1 },
    };
    await expect(
      updateContact(runtimeWith(prisma), admin, "c1", {
        kind: "client",
        fullName: "Иван",
        phone: "+79991112233",
      }),
    ).rejects.toMatchObject({ status: 422, code: "client_phone_locked" });
  });

  test("телефон клиента нельзя изменить на дубль → 409 duplicate_client_phone", async () => {
    const prisma = {
      contact: {
        findUnique: async () => clientRow,
        findFirst: async () => ({ id: "other" }),
      },
      lead: { count: async () => 0 },
    };
    await expect(
      updateContact(runtimeWith(prisma), admin, "c1", {
        kind: "client",
        fullName: "Иван",
        phone: "+79991112233",
      }),
    ).rejects.toMatchObject({ status: 409, code: "duplicate_client_phone" });
  });

  test("скрытый дубль при смене телефона клиента не раскрывается менеджеру как duplicate → 404", async () => {
    const ownClient = { ...clientRow, createdById: "m1" };
    const prisma = {
      contact: {
        findUnique: async () => ownClient,
        findFirst: async () => ({ id: "hidden", createdById: "m2" }),
      },
      lead: { count: async () => 0 },
    };
    await expect(
      updateContact(runtimeWith(prisma), manager, "c1", {
        kind: "client",
        fullName: "Иван",
        phone: "+79991112233",
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});
