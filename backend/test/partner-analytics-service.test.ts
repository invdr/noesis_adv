import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@gsk-tower/contracts";
import type { Runtime } from "../src/runtime";
import { getPartnerAnalytics } from "../src/partner-analytics/partner-analytics-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const admin = { id: "admin", email: "a@gsk.ru", role: "admin" } as unknown as SessionUser;
// Секунда назад, не «сейчас»: правая граница окна [from, to) в сервисе — это
// new Date() в момент вызова, и заявка с createdAt той же миллисекунды выпала
// бы из окна (флак, зависящий от тайминга прогона).
const now = new Date(Date.now() - 1000);
const wonStage = { kind: "won" as const };
const activeStage = { kind: "in_progress" as const };

/** Мок Prisma: приведённые заявки + партнёры (риелтор R в агентстве A). */
function prismaWith(opts: { agencyLastInteraction?: Date | null } = {}) {
  const leads = [
    { referrerId: "r", createdAt: now, stage: wonStage, statusEvents: [], notes: [] },
    { referrerId: "r", createdAt: now, stage: activeStage, statusEvents: [], notes: [] },
    { referrerId: "ag", createdAt: now, stage: wonStage, statusEvents: [], notes: [] },
  ];
  const partners = [
    {
      id: "r",
      kind: "realtor",
      fullName: "Пётр",
      phone: null,
      agencyId: "ag",
      agency: { fullName: "Этажи" },
      lastInteractionAt: null,
      archivedAt: null,
    },
    {
      id: "ag",
      kind: "agency",
      fullName: "Этажи",
      phone: null,
      agencyId: null,
      agency: null,
      lastInteractionAt: opts.agencyLastInteraction ?? null,
      archivedAt: null,
    },
  ];
  return {
    lead: { findMany: async () => leads },
    contact: { findMany: async () => partners },
  };
}

describe("getPartnerAnalytics", () => {
  test("считает приведённые/сделки/конверсию по риелтору", async () => {
    const res = await getPartnerAnalytics(runtimeWith(prismaWith()), admin, {});
    const realtor = res.rows.find((r) => r.contactId === "r")!;
    expect(realtor.referredLeads).toBe(2);
    expect(realtor.deals).toBe(1);
    expect(realtor.conversion).toBeCloseTo(0.5);
  });

  test("агентство сводит свои рефералы и рефералы своих риелторов", async () => {
    const res = await getPartnerAnalytics(runtimeWith(prismaWith()), admin, {});
    const agency = res.rows.find((r) => r.contactId === "ag")!;
    // Своя заявка (1 won) + риелтор (2 заявки, 1 won) = 3 приведено, 2 сделки.
    expect(agency.referredLeads).toBe(3);
    expect(agency.deals).toBe(2);
  });

  test("ручное «последнее взаимодействие» перекрывает расчётное", async () => {
    const manual = new Date("2030-01-01T00:00:00Z");
    const res = await getPartnerAnalytics(
      runtimeWith(prismaWith({ agencyLastInteraction: manual })),
      admin,
      {},
    );
    const agency = res.rows.find((r) => r.contactId === "ag")!;
    expect(agency.lastInteractionAt).toBe(manual.toISOString());
  });

  test("фильтр по типу отдаёт только запрошенный вид", async () => {
    const res = await getPartnerAnalytics(runtimeWith(prismaWith()), admin, { kind: "agency" });
    expect(res.rows.every((r) => r.kind === "agency")).toBe(true);
  });

  test("приведённые/сделки считаются только в окне [from, to), last-activity — за всё время", async () => {
    const inWindow = new Date("2026-06-15T00:00:00Z");
    const before = new Date("2026-05-01T00:00:00Z"); // до окна
    const after = new Date("2026-08-01T00:00:00Z"); // после окна (граница to исключается)
    const leads = [
      { referrerId: "r", createdAt: inWindow, stage: wonStage, statusEvents: [], notes: [] },
      { referrerId: "r", createdAt: before, stage: wonStage, statusEvents: [], notes: [] },
      { referrerId: "r", createdAt: after, stage: wonStage, statusEvents: [], notes: [] },
    ];
    const partners = [
      {
        id: "r",
        kind: "realtor",
        fullName: "Пётр",
        phone: null,
        agencyId: null,
        agency: null,
        lastInteractionAt: null,
        archivedAt: null,
      },
    ];
    const prisma = {
      lead: { findMany: async () => leads },
      contact: { findMany: async () => partners },
    };
    const res = await getPartnerAnalytics(runtimeWith(prisma), admin, {
      from: "2026-06-01T00:00:00Z",
      to: "2026-07-01T00:00:00Z",
    });
    const realtor = res.rows.find((r) => r.contactId === "r")!;
    // В окно попадает только заявка от 15 июня.
    expect(realtor.referredLeads).toBe(1);
    expect(realtor.deals).toBe(1);
    // Последняя активность — по всем заявкам, включая августовскую вне окна.
    expect(realtor.lastInteractionAt).toBe(after.toISOString());
  });

  test("архивный риелтор не показывается строкой, но его реферралы остаются в своде агентства", async () => {
    const leads = [
      { referrerId: "r_arch", createdAt: now, stage: wonStage, statusEvents: [], notes: [] },
      { referrerId: "r_arch", createdAt: now, stage: activeStage, statusEvents: [], notes: [] },
    ];
    const partners = [
      {
        id: "r_arch",
        kind: "realtor",
        fullName: "Архивный",
        phone: null,
        agencyId: "ag",
        agency: { fullName: "Этажи" },
        lastInteractionAt: null,
        archivedAt: new Date("2026-06-01T00:00:00Z"),
      },
      {
        id: "ag",
        kind: "agency",
        fullName: "Этажи",
        phone: null,
        agencyId: null,
        agency: null,
        lastInteractionAt: null,
        archivedAt: null,
      },
    ];
    const prisma = {
      lead: { findMany: async () => leads },
      contact: { findMany: async () => partners },
    };
    const res = await getPartnerAnalytics(runtimeWith(prisma), admin, {});
    // Архивный риелтор скрыт из строк…
    expect(res.rows.find((r) => r.contactId === "r_arch")).toBeUndefined();
    // …но его 2 реферрала (1 сделка) учтены в своде агентства.
    const agency = res.rows.find((r) => r.contactId === "ag")!;
    expect(agency.referredLeads).toBe(2);
    expect(agency.deals).toBe(1);
  });
});
