import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  computeFunnel,
  computeStageDurations,
  computeWeekly,
  getAnalytics,
} from "../src/analytics/analytics-service";

function runtimeWith(prisma: any): Runtime {
  return { env: {}, prisma } as unknown as Runtime;
}

const liveStages = [
  { id: "prog", name: "В работе", kind: "in_progress", color: "slate", order: 1 },
  { id: "won", name: "Сделка", kind: "won", color: "green", order: 2 },
  { id: "lost", name: "Отказ", kind: "lost", color: "red", order: 3 },
];

describe("getAnalytics", () => {
  test("пустой период — без деления на ноль", async () => {
    const prisma = {
      lead: { findMany: async () => [] },
      stage: { findMany: async () => liveStages },
      leadSource: {
        findMany: async () => [
          { id: "hero_form", name: "Главная форма" },
          { id: "contacts", name: "Контакты" },
        ],
      },
      project: { findMany: async () => [] },
      user: { findMany: async () => [] },
      leadStatusEvent: { findMany: async () => [] },
      leadContactEvent: { findMany: async () => [] },
    };
    const r = await getAnalytics(runtimeWith(prisma), {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-03T00:00:00.000Z",
    });
    expect(r.total).toBe(0);
    expect(r.funnel.every((f) => f.reached === 0)).toBe(true);
    expect(r.stageDuration).toEqual([]);
    expect(r.weekly).toEqual([]);
    expect(r.conversion.wonRate).toBe(0);
    expect(r.conversion.closeRate).toBe(0);
    expect(r.byStage.every((s) => s.count === 0)).toBe(true);
    expect(r.byManager).toEqual([]);
  });

  test("конверсия, бакеты по менеджерам и дням", async () => {
    const leads = [
      {
        id: "l1",
        source: "hero_form",
        projectId: null,
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
        assigneeId: "m1",
        stage: { id: "won", name: "Сделка", kind: "won" },
      },
      {
        id: "l2",
        source: "hero_form",
        projectId: null,
        createdAt: new Date("2026-06-01T11:00:00.000Z"),
        assigneeId: "a1", // закрыто за админом → «не распределено»
        stage: { id: "won", name: "Сделка", kind: "won" },
      },
      {
        id: "l3",
        source: "contacts",
        projectId: null,
        createdAt: new Date("2026-06-02T09:00:00.000Z"),
        assigneeId: null,
        stage: { id: "prog", name: "В работе", kind: "in_progress" },
      },
    ];
    const prisma = {
      lead: { findMany: async () => leads },
      stage: { findMany: async () => liveStages },
      leadSource: {
        findMany: async () => [
          { id: "hero_form", name: "Главная форма" },
          { id: "contacts", name: "Контакты" },
        ],
      },
      project: { findMany: async () => [] },
      user: {
        findMany: async () => [
          { id: "m1", email: "m1@gsk.ru", role: "manager" },
          { id: "a1", email: "a1@gsk.ru", role: "admin" },
        ],
      },
      leadStatusEvent: { findMany: async () => [] },
      leadContactEvent: { findMany: async () => [] },
    };
    const r = await getAnalytics(runtimeWith(prisma), {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-03T00:00:00.000Z",
    });

    expect(r.total).toBe(3);
    expect(r.conversion.won).toBe(2);
    expect(r.conversion.wonRate).toBeCloseTo(2 / 3, 5);
    expect(r.conversion.closeRate).toBe(1); // closed = won(2)+lost(0)

    const manager = r.byManager.find((m) => m.assigneeId === "m1");
    expect(manager).toMatchObject({ email: "m1@gsk.ru", leads: 1, won: 1 });
    const unassigned = r.byManager.find((m) => m.assigneeId === null);
    expect(unassigned).toMatchObject({ email: null, leads: 2, won: 1 });

    // Дни МСК: 06-01 → 2 заявки, 06-02 → 1, 06-03 → 0.
    expect(r.daily).toEqual([
      { date: "2026-06-01", count: 2 },
      { date: "2026-06-02", count: 1 },
      { date: "2026-06-03", count: 0 },
    ]);

    const wonStage = r.byStage.find((s) => s.stageId === "won");
    expect(wonStage?.count).toBe(2);
  });
});

const funnelStages = [
  { id: "new", name: "Новая" },
  { id: "prog", name: "В работе" },
  { id: "won", name: "Сделка" },
];

describe("computeFunnel", () => {
  test("считает уникальные заявки, достигшие каждого этапа", () => {
    const events = [
      // l1: new → prog → won (достиг всех трёх)
      { leadId: "l1", stageId: "new", createdAt: new Date("2026-06-01T00:00:00Z") },
      { leadId: "l1", stageId: "prog", createdAt: new Date("2026-06-02T00:00:00Z") },
      { leadId: "l1", stageId: "won", createdAt: new Date("2026-06-03T00:00:00Z") },
      // l2: new → prog (достиг двух)
      { leadId: "l2", stageId: "new", createdAt: new Date("2026-06-01T00:00:00Z") },
      { leadId: "l2", stageId: "prog", createdAt: new Date("2026-06-02T00:00:00Z") },
      // l3: только new
      { leadId: "l3", stageId: "new", createdAt: new Date("2026-06-01T00:00:00Z") },
    ];
    expect(computeFunnel(events, funnelStages)).toEqual([
      { stageId: "new", name: "Новая", reached: 3 },
      { stageId: "prog", name: "В работе", reached: 2 },
      { stageId: "won", name: "Сделка", reached: 1 },
    ]);
  });

  test("повторный вход на этап не удваивает заявку", () => {
    const events = [
      { leadId: "l1", stageId: "new", createdAt: new Date("2026-06-01T00:00:00Z") },
      { leadId: "l1", stageId: "prog", createdAt: new Date("2026-06-02T00:00:00Z") },
      { leadId: "l1", stageId: "new", createdAt: new Date("2026-06-03T00:00:00Z") }, // вернули
    ];
    const f = computeFunnel(events, funnelStages);
    expect(f.find((x) => x.stageId === "new")!.reached).toBe(1);
  });
});

describe("computeStageDurations", () => {
  test("среднее и медиана времени в этапе по парам соседних событий", () => {
    // Этап new: l1 провёл 24ч, l2 — 48ч → среднее 36, медиана 36.
    const events = [
      { leadId: "l1", stageId: "new", createdAt: new Date("2026-06-01T00:00:00Z") },
      { leadId: "l1", stageId: "won", createdAt: new Date("2026-06-02T00:00:00Z") }, // +24ч
      { leadId: "l2", stageId: "new", createdAt: new Date("2026-06-01T00:00:00Z") },
      { leadId: "l2", stageId: "won", createdAt: new Date("2026-06-03T00:00:00Z") }, // +48ч
    ];
    const d = computeStageDurations(events, funnelStages);
    const newStage = d.find((x) => x.stageId === "new")!;
    expect(newStage.avgHours).toBe(36);
    expect(newStage.medianHours).toBe(36);
    // Терминальный этап (won) без исходящего перехода — в срезе не появляется.
    expect(d.find((x) => x.stageId === "won")).toBeUndefined();
  });

  test("события сортируются по времени независимо от входного порядка", () => {
    const events = [
      { leadId: "l1", stageId: "won", createdAt: new Date("2026-06-02T00:00:00Z") },
      { leadId: "l1", stageId: "new", createdAt: new Date("2026-06-01T00:00:00Z") },
    ];
    const d = computeStageDurations(events, funnelStages);
    expect(d.find((x) => x.stageId === "new")!.avgHours).toBe(24);
  });
});

describe("computeWeekly", () => {
  test("created по дате поступления, won/lost по терминальному событию, недели с нулями", () => {
    // Недели МСК начинаются с понедельника. 2026-06-01 — понедельник.
    const leads = [
      { createdAt: new Date("2026-06-01T10:00:00Z") }, // неделя 06-01
      { createdAt: new Date("2026-06-02T10:00:00Z") }, // неделя 06-01
      { createdAt: new Date("2026-06-15T10:00:00Z") }, // неделя 06-15 (пропуск 06-08)
    ];
    const terminal = [
      { createdAt: new Date("2026-06-03T10:00:00Z"), kind: "won" as const },
      { createdAt: new Date("2026-06-16T10:00:00Z"), kind: "lost" as const },
    ];
    const w = computeWeekly(leads, terminal);
    expect(w).toEqual([
      { weekStart: "2026-06-01", created: 2, won: 1, lost: 0 },
      { weekStart: "2026-06-08", created: 0, won: 0, lost: 0 }, // нулевая неделя-пропуск
      { weekStart: "2026-06-15", created: 1, won: 0, lost: 1 },
    ]);
  });

  test("пустой ввод — пустой ряд", () => {
    expect(computeWeekly([], [])).toEqual([]);
  });
});
