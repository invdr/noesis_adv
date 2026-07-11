import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import {
  assignLead,
  createManualLead,
  csvCell,
  exportLeadsCsv,
  getLeadStats,
  normalizePhoneSearch,
  setLeadReferrer,
  updateNextContact,
  updateLeadConstruction,
  updateLeadSource,
  updateLeadStage,
} from "../src/leads/lead-service";
import type { LeadRow } from "../src/leads/lead-dto";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const admin = { id: "admin", email: "a@gsk.ru", role: "admin" } as unknown as SessionUser;
const manager = { id: "m1", email: "m@gsk.ru", role: "manager" } as unknown as SessionUser;

const stage = { id: "s_new", name: "Новая", kind: "in_progress" as const, funnelId: "f1" };

const leadRow = (over: Partial<LeadRow> = {}): LeadRow =>
  ({
    id: "lead1",
    name: "Иван",
    phone: "+79280000000",
    source: "hero_form",
    stageId: "s_new",
    stage,
    constructionId: null,
    message: null,
    assigneeId: null,
    isRepeat: false,
    nextContactAt: null,
    nextContactTypeId: "ct_old",
    consentAt: new Date(),
    consentIp: "0.0.0.0",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as LeadRow;

describe("updateNextContact", () => {
  // Транзакция: lead.update + (при реальном изменении) событие истории задач.
  const ncTx =
    (capture: (d: any) => void, event: (e: any) => void = () => {}) =>
    async (fn: any) =>
      fn({
        lead: {
          update: async ({ data }: any) => {
            capture(data);
            return leadRow({
              nextContactAt: data.nextContactAt ?? null,
              nextContactTypeId:
                data.nextContactTypeId === undefined ? "ct_old" : data.nextContactTypeId,
            });
          },
        },
        leadContactEvent: {
          create: async ({ data }: any) => {
            event(data);
            return {};
          },
        },
      });

  test("дата без поля типа не затирает существующий тип; событие со снимком имени", async () => {
    let updateData: any;
    let evt: any;
    const prisma = {
      lead: { findUnique: async () => leadRow() },
      // Лукап имени типа для снимка в событие (валидация не выполняется).
      contactType: { findUnique: async () => ({ id: "ct_old", name: "Звонок", archivedAt: null }) },
      $transaction: ncTx((d) => (updateData = d), (e) => (evt = e)),
    };

    await updateNextContact(runtimeWith(prisma), admin, "lead1", {
      nextContactAt: "2026-07-01T10:00:00.000Z",
    });

    expect(updateData.nextContactAt).toBeInstanceOf(Date);
    // undefined → Prisma не трогает поле, существующий тип сохраняется.
    expect(updateData.nextContactTypeId).toBeUndefined();
    expect(evt.at).toBeInstanceOf(Date);
    expect(evt.typeName).toBe("Звонок"); // снимок имени существующего типа
    expect(evt.authorId).toBe("admin");
  });

  test("снятие даты сбрасывает тип и пишет событие «снято»", async () => {
    let updateData: any;
    let evt: any;
    const prisma = {
      lead: { findUnique: async () => leadRow({ nextContactAt: new Date() }) },
      $transaction: ncTx((d) => (updateData = d), (e) => (evt = e)),
    };

    await updateNextContact(runtimeWith(prisma), admin, "lead1", {
      nextContactAt: null,
      nextContactTypeId: "ct_x",
    });

    expect(updateData.nextContactAt).toBeNull();
    expect(updateData.nextContactTypeId).toBeNull();
    expect(evt.at).toBeNull(); // «напоминание снято»
    expect(evt.typeName).toBeNull();
  });

  test("повторное сохранение без изменений не пишет событие", async () => {
    const at = new Date("2026-07-01T10:00:00.000Z");
    let evt: any;
    const prisma = {
      lead: { findUnique: async () => leadRow({ nextContactAt: at, nextContactTypeId: "ct_old" }) },
      contactType: { findUnique: async () => ({ id: "ct_old", name: "Звонок", archivedAt: null }) },
      $transaction: ncTx(() => {}, (e) => (evt = e)),
    };

    await updateNextContact(runtimeWith(prisma), admin, "lead1", {
      nextContactAt: at.toISOString(),
      nextContactTypeId: "ct_old",
    });

    expect(evt).toBeUndefined(); // ничего не поменялось — лента не засоряется
  });

  test("архивный тип контакта отклоняется (422)", async () => {
    const prisma = {
      lead: { findUnique: async () => leadRow() },
      contactType: { findUnique: async () => ({ id: "ct_x", archivedAt: new Date() }) },
    };

    await expect(
      updateNextContact(runtimeWith(prisma), admin, "lead1", {
        nextContactAt: "2026-07-01T10:00:00.000Z",
        nextContactTypeId: "ct_x",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_contact_type" });
  });

  test("неизменный (ставший архивным) тип сохраняется — дату можно подвинуть", async () => {
    let updateData: any;
    const prisma = {
      lead: {
        // У заявки уже стоит тип ct_old, который успел уйти в архив.
        findUnique: async () => leadRow({ nextContactTypeId: "ct_old" }),
      },
      // Валидация неизменного типа не выполняется (иначе был бы 422) —
      // findUnique зовётся только за именем для снимка в событие.
      contactType: { findUnique: async () => ({ id: "ct_old", name: "Звонок", archivedAt: new Date() }) },
      $transaction: ncTx((d) => (updateData = d)),
    };

    await updateNextContact(runtimeWith(prisma), admin, "lead1", {
      nextContactAt: "2026-07-01T10:00:00.000Z",
      nextContactTypeId: "ct_old",
    });

    expect(updateData.nextContactTypeId).toBe("ct_old");
  });

  test("несуществующий тип контакта отклоняется (422)", async () => {
    const prisma = {
      lead: { findUnique: async () => leadRow() },
      contactType: { findUnique: async () => null },
    };

    await expect(
      updateNextContact(runtimeWith(prisma), admin, "lead1", {
        nextContactAt: "2026-07-01T10:00:00.000Z",
        nextContactTypeId: "ghost",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_contact_type" });
  });

  test("несуществующая заявка → null", async () => {
    const prisma = { lead: { findUnique: async () => null } };
    expect(
      await updateNextContact(runtimeWith(prisma), admin, "missing", {
        nextContactAt: null,
      }),
    ).toBeNull();
  });
});

describe("updateLeadSource", () => {
  test("админ меняет источник заявки", async () => {
    let updateData: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: {
        findUnique: async () => leadRow(),
        update: async ({ data }: any) => {
          updateData = data;
          return leadRow({ source: data.source });
        },
      },
    };
    const res = await updateLeadSource(runtimeWith(prisma), admin, "lead1", {
      source: "contacts",
    });
    expect(updateData.source).toBe("contacts");
    expect(res?.source).toBe("contacts");
  });

  test("несуществующая заявка → null", async () => {
    const prisma = { lead: { findUnique: async () => null } };
    expect(
      await updateLeadSource(runtimeWith(prisma), admin, "x", { source: "other" }),
    ).toBeNull();
  });

  test("менеджер не может править чужую заявку (403)", async () => {
    const manager = { id: "m1", email: "m@gsk.ru", role: "manager" } as unknown as SessionUser;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findUnique: async () => leadRow({ assigneeId: "other_manager" }) },
    };
    await expect(
      updateLeadSource(runtimeWith(prisma), manager, "lead1", { source: "other" }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("updateLeadConstruction", () => {
  test("меняет конструкцию заявки", async () => {
    let updateData: any;
    const prisma = {
      lead: {
        findUnique: async () => leadRow({ constructionId: null }),
        update: async ({ data }: any) => {
          updateData = data;
          return leadRow({ constructionId: data.constructionId, construction: { name: "СФ-001" } });
        },
      },
      construction: { findUnique: async () => ({ id: "p1", archivedAt: null }) },
    };
    const res = await updateLeadConstruction(runtimeWith(prisma), admin, "lead1", {
      constructionId: "p1",
    });
    expect(updateData.constructionId).toBe("p1");
    expect(res?.constructionId).toBe("p1");
    expect(res?.constructionName).toBe("СФ-001");
  });

  test("снимает конструкцию без проверки справочника", async () => {
    let updateData: any;
    const prisma = {
      lead: {
        findUnique: async () => leadRow({ constructionId: "p1" }),
        update: async ({ data }: any) => {
          updateData = data;
          return leadRow({ constructionId: data.constructionId, construction: null });
        },
      },
      construction: {
        findUnique: async () => {
          throw new Error("не должно вызываться");
        },
      },
    };
    const res = await updateLeadConstruction(runtimeWith(prisma), admin, "lead1", {
      constructionId: null,
    });
    expect(updateData.constructionId).toBeNull();
    expect(res?.constructionId).toBeNull();
  });

  test("архивная конструкция отклоняется (422)", async () => {
    const prisma = {
      lead: { findUnique: async () => leadRow() },
      construction: { findUnique: async () => ({ id: "p1", archivedAt: new Date() }) },
    };
    await expect(
      updateLeadConstruction(runtimeWith(prisma), admin, "lead1", { constructionId: "p1" }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_construction" });
  });
});

describe("updateLeadStage", () => {
  // Транзакция с инжектируемым tx (updateLeadStage пишет lead + событие истории).
  const txRunner = (capture: (data: any) => void) => async (fn: any) =>
    fn({
      lead: {
        update: async ({ data }: any) => {
          capture(data);
          return leadRow({
            stageId: data.stageId,
            stage: { id: data.stageId, name: "Этап", kind: "in_progress", funnelId: "f2" },
          });
        },
      },
      leadStatusEvent: { create: async () => ({}) },
      leadContactEvent: {
        create: async ({ data }: any) => {
          contactEvents.push(data);
          return {};
        },
      },
    });
  // Захваченные события задач (закрытие снимает напоминание) — чистим в тестах.
  let contactEvents: any[] = [];

  test("разрешает перевод в живой этап другой воронки (освобождение воронки)", async () => {
    let data: any;
    const prisma = {
      lead: { findUnique: async () => leadRow() },
      stage: {
        findUnique: async () => ({ id: "t_other", kind: "in_progress", funnelId: "f2", archivedAt: null }),
      },
      $transaction: txRunner((d) => (data = d)),
    };
    const res = await updateLeadStage(runtimeWith(prisma), admin, "lead1", { stageId: "t_other" });
    expect(data.stageId).toBe("t_other");
    expect(res?.stage.funnelId).toBe("f2"); // заявка ушла в другую воронку
    // in_progress → дату/тип не трогаем (undefined).
    expect(data.nextContactAt).toBeUndefined();
    expect(data.nextContactTypeId).toBeUndefined();
  });

  test("перевод в терминальный этап чистит дату и тип контакта", async () => {
    let data: any;
    contactEvents = [];
    const prisma = {
      lead: {
        findUnique: async () =>
          leadRow({ nextContactAt: new Date(), nextContactTypeId: "ct_old" }),
      },
      stage: {
        findUnique: async () => ({ id: "won", kind: "won", funnelId: "f1", archivedAt: null }),
      },
      $transaction: txRunner((d) => (data = d)),
    };
    await updateLeadStage(runtimeWith(prisma), admin, "lead1", { stageId: "won" });
    expect(data.nextContactAt).toBeNull();
    expect(data.nextContactTypeId).toBeNull();
    // Снятое закрытием напоминание фиксируется в истории задач.
    expect(contactEvents).toHaveLength(1);
    expect(contactEvents[0]).toMatchObject({ at: null, authorId: "admin" });
  });

  test("закрытие без назначенного напоминания события задач не пишет", async () => {
    contactEvents = [];
    const prisma = {
      lead: { findUnique: async () => leadRow({ nextContactAt: null }) },
      stage: {
        findUnique: async () => ({ id: "won", kind: "won", funnelId: "f1", archivedAt: null }),
      },
      $transaction: txRunner(() => {}),
    };
    await updateLeadStage(runtimeWith(prisma), admin, "lead1", { stageId: "won" });
    expect(contactEvents).toHaveLength(0);
  });

  test("архивный целевой этап отклоняется (422)", async () => {
    const prisma = {
      lead: { findUnique: async () => leadRow() },
      stage: {
        findUnique: async () => ({ id: "x", kind: "in_progress", funnelId: "f1", archivedAt: new Date() }),
      },
    };
    await expect(
      updateLeadStage(runtimeWith(prisma), admin, "lead1", { stageId: "x" }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_stage" });
  });

  test("несуществующая заявка → null", async () => {
    const prisma = { lead: { findUnique: async () => null } };
    expect(
      await updateLeadStage(runtimeWith(prisma), admin, "x", { stageId: "s_new" }),
    ).toBeNull();
  });
});

describe("setLeadReferrer", () => {
  test("привязывает действующего риелтора", async () => {
    let updateData: any;
    const prisma = {
      lead: {
        findUnique: async () => leadRow(),
        update: async ({ data }: any) => {
          updateData = data;
          return leadRow({ referrerId: data.referrerId });
        },
      },
      contact: {
        findUnique: async () => ({ id: "r1", isPartner: true, archivedAt: null }),
      },
    };
    const res = await setLeadReferrer(runtimeWith(prisma), admin, "lead1", { referrerId: "r1" });
    expect(updateData.referrerId).toBe("r1");
    expect(res?.referrerId).toBe("r1");
  });

  test("клиента в рефереры не берём (422)", async () => {
    const prisma = {
      lead: { findUnique: async () => leadRow() },
      contact: { findUnique: async () => ({ id: "c1", isPartner: false, archivedAt: null }) },
    };
    await expect(
      setLeadReferrer(runtimeWith(prisma), admin, "lead1", { referrerId: "c1" }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_referrer" });
  });

  test("снятие реферера (null) не требует проверки контакта", async () => {
    let updateData: any;
    const prisma = {
      lead: {
        findUnique: async () => leadRow({ referrerId: "r1" }),
        update: async ({ data }: any) => {
          updateData = data;
          return leadRow({ referrerId: null });
        },
      },
      contact: {
        findUnique: async () => {
          throw new Error("не должно вызываться");
        },
      },
    };
    const res = await setLeadReferrer(runtimeWith(prisma), admin, "lead1", { referrerId: null });
    expect(updateData.referrerId).toBeNull();
    expect(res?.referrerId).toBeNull();
  });
});

describe("createManualLead", () => {
  // Транзакция приёма: findOrCreateClientByPhone (tx.contact) + lead.create + событие.
  const manualTx =
    (
      capture: (d: any) => void,
      event: (e: any) => void,
      existingContact: any = { id: "c1", archivedAt: null },
      assignEvent: (e: any) => void = () => {},
    ) =>
    async (fn: any) =>
      fn({
        contact: {
          findFirst: async () => existingContact,
          update: async () => ({}),
          create: async () => ({ id: "c_new" }),
        },
        lead: {
          create: async ({ data }: any) => {
            capture(data);
            return leadRow({ ...data, stage });
          },
        },
        leadStatusEvent: {
          create: async ({ data }: any) => {
            event(data);
            return {};
          },
        },
        leadAssignEvent: {
          create: async ({ data }: any) => {
            assignEvent(data);
            return {};
          },
        },
      });

  test("оффлайн-приём: источник, дедуп клиента, согласие оператора, автор события", async () => {
    let data: any;
    let evt: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findFirst: async () => null }, // resolveRepeat: не повторная
      stage: { findFirst: async () => ({ id: "s_new" }) }, // getEntryStageId
      $transaction: manualTx((d) => (data = d), (e) => (evt = e)),
    };
    const res = await createManualLead(runtimeWith(prisma), admin, {
      name: "Иван",
      phone: "+79280000000",
      consent: true,
      source: "offline",
    });
    expect(data.source).toBe("offline");
    expect(data.contactId).toBe("c1"); // дедуп по телефону вернул существующего
    expect(data.consentIp).toBe(""); // оффлайн: IP нет
    expect(data.assigneeId).toBeNull(); // не выбран → общая очередь
    expect(data.isRepeat).toBe(false);
    expect(data.consentAt).toBeInstanceOf(Date); // согласие зафиксировано «сейчас»
    expect(evt.authorId).toBe("admin"); // аудит: событие от оператора, не системное
    expect(res.source).toBe("offline");
  });

  test("оффлайн-приём с выбранным клиентом привязывает именно его", async () => {
    let data: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      contact: {
        findUnique: async () => ({
          id: "c_selected",
          isClient: true,
          fullName: "Мария",
          phone: "+79991112233",
          archivedAt: null,
          createdById: "m1",
        }),
      },
      lead: { count: async () => 0, findFirst: async () => null },
      stage: { findFirst: async () => ({ id: "s_new" }) },
      $transaction: async (fn: any) =>
        fn({
          contact: {
            findFirst: async () => {
              throw new Error("не должно искать клиента по телефону");
            },
            create: async () => {
              throw new Error("не должно создавать клиента");
            },
          },
          lead: {
            create: async ({ data: d }: any) => {
              data = d;
              return leadRow({ ...d, stage, contact: { fullName: "Мария" } });
            },
          },
          leadStatusEvent: { create: async () => ({}) },
          leadAssignEvent: { create: async () => ({}) },
        }),
    };
    const res = await createManualLead(runtimeWith(prisma), manager, {
      name: "Игнор",
      phone: "+79280000000",
      consent: true,
      source: "offline",
      contactId: "c_selected",
    });
    expect(data.contactId).toBe("c_selected");
    expect(data.name).toBe("Мария");
    expect(data.phone).toBe("+79991112233");
    expect(res.contactName).toBe("Мария");
  });

  test("оффлайн-приём с выбранным клиентом не даёт менеджеру взять своего бывшего клиента с чужими заявками", async () => {
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      contact: {
        findUnique: async () => ({
          id: "c_hidden",
          isClient: true,
          fullName: "Мария",
          phone: "+79991112233",
          archivedAt: null,
          createdById: "m1",
        }),
      },
      lead: {
        count: async ({ where }: any) => (where?.AND ? 0 : 1),
      },
    };
    await expect(
      createManualLead(runtimeWith(prisma), manager, {
        name: "Игнор",
        phone: "+79280000000",
        consent: true,
        source: "offline",
        contactId: "c_hidden",
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  test("реферер-клиент/архивный отклоняется (422 invalid_referrer)", async () => {
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      contact: { findUnique: async () => ({ id: "c1", isPartner: false, archivedAt: null }) },
    };
    await expect(
      createManualLead(runtimeWith(prisma), admin, {
        name: "Иван",
        phone: "+79280000000",
        consent: true,
        source: "offline",
        referrerId: "c1",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_referrer" });
  });

  test("оффлайн-приём с новым риелтором создаёт реферера в той же транзакции", async () => {
    let contactData: any;
    let leadData: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findFirst: async () => null },
      stage: { findFirst: async () => ({ id: "s_new" }) },
      $transaction: async (fn: any) =>
        fn({
          contact: {
            findFirst: async () => ({ id: "c1", archivedAt: null }),
            update: async () => ({}),
            create: async ({ data }: any) => {
              contactData = data;
              return { id: "r_new" };
            },
          },
          lead: {
            create: async ({ data }: any) => {
              leadData = data;
              return leadRow({ ...data, stage });
            },
          },
          leadStatusEvent: { create: async () => ({}) },
          leadAssignEvent: { create: async () => ({}) },
        }),
    };
    await createManualLead(runtimeWith(prisma), manager, {
      name: "Иван",
      phone: "+79280000000",
      consent: true,
      source: "offline",
      newReferrer: { fullName: "Пётр Риелтор", phone: "+79991112233" },
    });
    expect(contactData).toMatchObject({
      type: "individual",
      isClient: false,
      isPartner: true,
      fullName: "Пётр Риелтор",
      phone: "+79991112233",
      createdById: "m1",
    });
    expect(leadData.referrerId).toBe("r_new");
  });

  test("менеджер не может назначить заявку на другого менеджера (403, fail-fast)", async () => {
    // Пустой prisma: проверка прав раньше любых запросов к БД (иначе тест упал бы).
    await expect(
      createManualLead(runtimeWith({}), manager, {
        name: "Иван",
        phone: "+79280000000",
        consent: true,
        source: "offline",
        assigneeId: "someone_else",
      }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  test("admin назначает заявку на другого действующего менеджера", async () => {
    let data: any;
    let assignEvt: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findFirst: async () => null },
      user: { findUnique: async () => ({ id: "m2", role: "manager", isActive: true }) },
      stage: { findFirst: async () => ({ id: "s_new" }) },
      $transaction: manualTx((d) => (data = d), () => {}, undefined, (e) => (assignEvt = e)),
    };
    const res = await createManualLead(runtimeWith(prisma), admin, {
      name: "Иван",
      phone: "+79280000000",
      consent: true,
      source: "offline",
      assigneeId: "m2",
    });
    expect(data.assigneeId).toBe("m2");
    expect(res.assigneeId).toBe("m2");
    // Явное назначение оператором фиксируется в истории с его авторством.
    expect(assignEvt).toMatchObject({ assigneeId: "m2", authorId: "admin" });
  });

  test("неактивный/не-менеджер в ответственные → 422 invalid_assignee", async () => {
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findFirst: async () => null },
      user: { findUnique: async () => ({ id: "u1", role: "admin", isActive: true }) }, // не менеджер
    };
    await expect(
      createManualLead(runtimeWith(prisma), admin, {
        name: "Иван",
        phone: "+79280000000",
        consent: true,
        source: "offline",
        assigneeId: "u1",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_assignee" });
  });

  test("архивный реферер → 422 invalid_referrer", async () => {
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      contact: { findUnique: async () => ({ id: "r1", kind: "realtor", archivedAt: new Date() }) },
    };
    await expect(
      createManualLead(runtimeWith(prisma), admin, {
        name: "Иван",
        phone: "+79280000000",
        consent: true,
        source: "offline",
        referrerId: "r1",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_referrer" });
  });

  test("заявка падает во входной этап выбранной воронки (funnelId)", async () => {
    let data: any;
    let stageWhere: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findFirst: async () => null },
      stage: {
        findFirst: async ({ where }: any) => {
          stageWhere = where;
          return { id: "s_realtor_entry" };
        },
      },
      $transaction: manualTx((d) => (data = d), () => {}),
    };
    await createManualLead(runtimeWith(prisma), admin, {
      name: "Иван",
      phone: "+79280000000",
      consent: true,
      source: "offline",
      funnelId: "f_realtors",
    });
    expect(stageWhere.funnel).toEqual({ id: "f_realtors", archivedAt: null });
    expect(data.stageId).toBe("s_realtor_entry");
  });

  test("без funnelId — входной этап воронки по умолчанию", async () => {
    let stageWhere: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findFirst: async () => null },
      stage: {
        findFirst: async ({ where }: any) => {
          stageWhere = where;
          return { id: "s_new" };
        },
      },
      $transaction: manualTx(() => {}, () => {}),
    };
    await createManualLead(runtimeWith(prisma), admin, {
      name: "Иван",
      phone: "+79280000000",
      consent: true,
      source: "offline",
    });
    expect(stageWhere.funnel).toEqual({ isDefault: true, archivedAt: null });
  });

  test("несуществующая/архивная воронка → 422 invalid_funnel", async () => {
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findFirst: async () => null },
      stage: { findFirst: async () => null },
    };
    await expect(
      createManualLead(runtimeWith(prisma), admin, {
        name: "Иван",
        phone: "+79280000000",
        consent: true,
        source: "offline",
        funnelId: "f_ghost",
      }),
    ).rejects.toMatchObject({ status: 422, code: "invalid_funnel" });
  });

  test("повторная заявка наследует ответственного прошлой активной", async () => {
    let data: any;
    let assignEvt: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: {
        findFirst: async () => ({
          stage: { kind: "in_progress" },
          assignee: { id: "m1", role: "manager", isActive: true },
        }),
      },
      stage: { findFirst: async () => ({ id: "s_new" }) },
      $transaction: manualTx((d) => (data = d), () => {}, undefined, (e) => (assignEvt = e)),
    };
    const res = await createManualLead(runtimeWith(prisma), admin, {
      name: "Иван",
      phone: "+79280000000",
      consent: true,
      source: "offline",
    });
    expect(data.isRepeat).toBe(true);
    expect(data.assigneeId).toBe("m1"); // унаследован от прошлой заявки
    expect(res.isRepeat).toBe(true);
    // Авто-назначение — системное событие (без автора).
    expect(assignEvt).toMatchObject({ assigneeId: "m1", authorId: null });
  });
});

describe("assignLead — история назначений", () => {
  test("переназначение пишет событие с автором-инициатором", async () => {
    let assignEvt: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findUnique: async () => leadRow({ assigneeId: null }) },
      user: { findUnique: async () => ({ id: "m2", role: "manager", isActive: true }) },
      $transaction: async (fn: any) =>
        fn({
          lead: {
            update: async ({ data }: any) => leadRow({ ...data, stage }),
          },
          leadAssignEvent: {
            create: async ({ data }: any) => {
              assignEvt = data;
              return {};
            },
          },
        }),
    };
    const res = await assignLead(runtimeWith(prisma), admin, "lead1", { assigneeId: "m2" });
    expect(res?.assigneeId).toBe("m2");
    expect(assignEvt).toMatchObject({ leadId: "lead1", assigneeId: "m2", authorId: "admin" });
  });

  test("возврат в очередь фиксируется событием с assigneeId=null", async () => {
    let assignEvt: any;
    const prisma = {
      leadSource: { findUnique: async () => ({ id: "offline", isWeb: false, archivedAt: null }) },
      lead: { findUnique: async () => leadRow({ assigneeId: "m1" }) },
      $transaction: async (fn: any) =>
        fn({
          lead: {
            update: async ({ data }: any) => leadRow({ ...data, stage }),
          },
          leadAssignEvent: {
            create: async ({ data }: any) => {
              assignEvt = data;
              return {};
            },
          },
        }),
    };
    await assignLead(runtimeWith(prisma), manager, "lead1", { assigneeId: null });
    expect(assignEvt).toMatchObject({ leadId: "lead1", assigneeId: null, authorId: "m1" });
  });
});

describe("normalizePhoneSearch", () => {
  test("выдёргивает цифры и приводит ведущую 8 к 7 (формат хранения +7…)", () => {
    expect(normalizePhoneSearch("8 (912) 345-67-89")).toBe("79123456789");
    expect(normalizePhoneSearch("+7 912 345")).toBe("7912345");
    expect(normalizePhoneSearch("912-345")).toBe("912345");
  });

  test("короткий/нецифровой ввод — не телефонный запрос", () => {
    expect(normalizePhoneSearch("Иван")).toBeNull();
    expect(normalizePhoneSearch("12")).toBeNull();
  });
});

describe("csvCell", () => {
  test("нейтрализует формулы Excel префиксом «'»", () => {
    expect(csvCell("=1+2")).toBe("'=1+2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+cmd|/c calc")).toBe("'+cmd|/c calc");
    expect(csvCell("-2+3+cmd")).toBe("'-2+3+cmd");
  });

  test("телефон и отрицательное число остаются как есть (это не формулы)", () => {
    expect(csvCell("+79280000000")).toBe("+79280000000");
    expect(csvCell("-42")).toBe("-42");
  });

  test("кавычки и разделители экранируются по RFC 4180", () => {
    expect(csvCell('Иван "Т", ООО')).toBe('"Иван ""Т"", ООО"');
    // Нейтрализация и экранирование вместе: формула с запятой.
    expect(csvCell("=SUM(1,2)")).toBe('"\'=SUM(1,2)"');
  });
});

describe("exportLeadsCsv", () => {
  const csvRuntime = (over: any = {}) =>
    runtimeWith({
      lead: {
        findMany: async () => [
          // Название конструкции приходит развёрнутым в самой выборке (leadInclude).
          leadRow({ constructionId: "p1", assigneeId: "m1", construction: { name: "СФ-001" } }),
          leadRow({ id: "lead2", name: "=HYPERLINK(...)", constructionId: null }),
        ],
        count: async () => 2,
      },
      user: { findMany: async () => [{ id: "m1", email: "m@gsk.ru" }] },
      ...over,
    });

  test("колонка «Конструкция» — название конструкции, имя-формула нейтрализовано", async () => {
    const csv = await exportLeadsCsv(csvRuntime(), admin, {
      page: 1,
      pageSize: 25,
    } as any);
    expect(csv).toContain("СФ-001");
    expect(csv).not.toContain(",p1,"); // сырой id в ячейку не попадает
    expect(csv).toContain("'=HYPERLINK"); // имя с лендинга обезврежено
    expect(csv).not.toContain("сузьте фильтры"); // всё влезло — отметки нет
  });

  test("при превышении потолка последняя строка сообщает об обрезке", async () => {
    const csv = await exportLeadsCsv(
      csvRuntime({
        lead: {
          findMany: async () => [leadRow({ constructionId: null, assigneeId: null })],
          count: async () => 9001,
        },
      }),
      admin,
      { page: 1, pageSize: 25 } as any,
    );
    const lastLine = csv.trimEnd().split("\r\n").at(-1) ?? "";
    expect(lastLine).toContain("Выгружены первые 1 из 9001 заявок");
  });
});

describe("getLeadStats", () => {
  test("manager stats are scoped to leads visible to that manager", async () => {
    const wheres: any[] = [];
    const prisma = {
      lead: {
        count: async ({ where }: any) => {
          wheres.push(where);
          return 2;
        },
        groupBy: async ({ by, where }: any) => {
          wheres.push(where);
          return by[0] === "stageId"
            ? [{ stageId: "s_new", _count: { _all: 2 } }]
            : [{ source: "hero_form", _count: { _all: 2 } }];
        },
      },
    };

    const stats = await getLeadStats(runtimeWith(prisma), manager);

    expect(stats).toEqual({
      total: 2,
      byStage: { s_new: 2 },
      bySource: { hero_form: 2 },
    });
    expect(wheres).toEqual([
      { OR: [{ assigneeId: "m1" }, { assigneeId: null }] },
      { OR: [{ assigneeId: "m1" }, { assigneeId: null }] },
      { OR: [{ assigneeId: "m1" }, { assigneeId: null }] },
    ]);
  });

  test("admin stats remain global", async () => {
    const wheres: any[] = [];
    const prisma = {
      lead: {
        count: async ({ where }: any) => {
          wheres.push(where);
          return 3;
        },
        groupBy: async ({ where }: any) => {
          wheres.push(where);
          return [];
        },
      },
    };

    await getLeadStats(runtimeWith(prisma), admin);

    expect(wheres).toEqual([{}, {}, {}]);
  });
});
