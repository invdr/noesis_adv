import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import { archiveFunnel } from "../src/funnels/funnel-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const funnelRow = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  name: "Продажи",
  order: 1,
  isDefault: false,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe("archiveFunnel (гарды)", () => {
  test("нельзя архивировать уже архивную воронку (409)", async () => {
    const prisma = {
      funnel: { findUnique: async () => funnelRow({ archivedAt: new Date() }) },
    };
    await expect(archiveFunnel(runtimeWith(prisma), "f1")).rejects.toMatchObject({
      status: 409,
      code: "funnel_archived",
    });
  });

  test("нельзя архивировать воронку по умолчанию (409)", async () => {
    const prisma = {
      funnel: { findUnique: async () => funnelRow({ isDefault: true }) },
    };
    await expect(archiveFunnel(runtimeWith(prisma), "f1")).rejects.toMatchObject({
      status: 409,
      code: "default_funnel",
    });
  });

  test("нельзя архивировать последнюю живую воронку (409)", async () => {
    const prisma = {
      funnel: { findUnique: async () => funnelRow(), count: async () => 0 },
    };
    await expect(archiveFunnel(runtimeWith(prisma), "f1")).rejects.toMatchObject({
      status: 409,
      code: "last_funnel",
    });
  });

  test("нельзя архивировать воронку с заявками (409)", async () => {
    const prisma = {
      funnel: { findUnique: async () => funnelRow(), count: async () => 2 },
      lead: { count: async () => 3 },
    };
    await expect(archiveFunnel(runtimeWith(prisma), "f1")).rejects.toMatchObject({
      status: 409,
      code: "funnel_has_leads",
    });
  });
});
