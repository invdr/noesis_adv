import { describe, expect, test } from "bun:test";
import type { SessionUser } from "@noesis/contracts";
import type { Runtime } from "../src/runtime";
import { getPartnerAnalytics } from "../src/partner-analytics/partner-analytics-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const admin = { id: "admin", email: "a@gsk.ru", role: "admin" } as unknown as SessionUser;
const now = new Date(Date.now() - 1_000);
const wonStage = { kind: "won" as const };
const activeStage = { kind: "in_progress" as const };

function prismaWith(opts: { companyLastInteraction?: Date | null } = {}) {
  return {
    lead: {
      findMany: async () => [
        { referrerId: "p", createdAt: now, stage: wonStage, statusEvents: [], notes: [] },
        { referrerId: "p", createdAt: now, stage: activeStage, statusEvents: [], notes: [] },
        { referrerId: "co", createdAt: now, stage: wonStage, statusEvents: [], notes: [] },
      ],
    },
    contact: {
      findMany: async () => [
        {
          id: "p",
          type: "individual",
          isPartner: true,
          fullName: "Пётр",
          organizationId: "co",
          organization: { fullName: "Компания" },
          lastInteractionAt: null,
          archivedAt: null,
        },
        {
          id: "co",
          type: "company",
          isPartner: true,
          fullName: "Компания",
          organizationId: null,
          organization: null,
          lastInteractionAt: opts.companyLastInteraction ?? null,
          archivedAt: null,
        },
      ],
    },
  };
}

describe("getPartnerAnalytics", () => {
  test("считает лиды, сделки и конверсию партнёра-человека", async () => {
    const rows = (await getPartnerAnalytics(runtimeWith(prismaWith()), admin, {})).rows;
    const partner = rows.find((row) => row.contactId === "p")!;
    expect(partner.referredLeads).toBe(2);
    expect(partner.deals).toBe(1);
    expect(partner.conversion).toBeCloseTo(0.5);
    expect(partner.organizationName).toBe("Компания");
  });

  test("компания суммирует собственные и приведённые представителями сделки", async () => {
    const rows = (await getPartnerAnalytics(runtimeWith(prismaWith()), admin, {})).rows;
    const company = rows.find((row) => row.contactId === "co")!;
    expect(company.referredLeads).toBe(3);
    expect(company.deals).toBe(2);
  });

  test("ручная дата имеет приоритет над датой активности", async () => {
    const manual = new Date("2030-01-01T00:00:00Z");
    const rows = (await getPartnerAnalytics(runtimeWith(prismaWith({ companyLastInteraction: manual })), admin, {})).rows;
    expect(rows.find((row) => row.contactId === "co")!.lastInteractionAt).toBe(manual.toISOString());
  });

  test("фильтр вида оставляет только компании", async () => {
    const rows = (await getPartnerAnalytics(runtimeWith(prismaWith()), admin, { type: "company" })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("company");
  });

  test("архивный представитель не показан, но его результаты входят в свод компании", async () => {
    const prisma: any = prismaWith();
    prisma.contact.findMany = async () => [
      {
        id: "p",
        type: "individual",
        isPartner: true,
        fullName: "Пётр",
        organizationId: "co",
        organization: { fullName: "Компания" },
        lastInteractionAt: null,
        archivedAt: new Date(),
      },
      {
        id: "co",
        type: "company",
        isPartner: true,
        fullName: "Компания",
        organizationId: null,
        organization: null,
        lastInteractionAt: null,
        archivedAt: null,
      },
    ];
    const rows = (await getPartnerAnalytics(runtimeWith(prisma), admin, {})).rows;
    expect(rows.find((row) => row.contactId === "p")).toBeUndefined();
    expect(rows.find((row) => row.contactId === "co")!.referredLeads).toBe(3);
  });
});
