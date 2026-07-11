import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnalyticsResponse, InventoryAnalyticsResponse, SessionUser } from "@noesis/contracts";
import { api } from "../src/api/client";
import { AnalyticsView } from "../src/analytics/AnalyticsView";

/**
 * Дымовой тест шелла «Аналитика» с вкладками: инвентарь доступен всем,
 * лидовая аналитика — только admin, партнёрская — всем.
 */

const EMPTY_ANALYTICS: AnalyticsResponse = {
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-02-01T00:00:00.000Z",
  total: 0,
  byStage: [],
  bySource: [],
  byProject: [],
  conversion: { won: 0, lost: 0, inProgress: 0, wonRate: 0, closeRate: 0 },
  daily: [],
  byManager: [],
  funnel: [],
  stageDuration: [],
  weekly: [],
};

const EMPTY_INVENTORY_ANALYTICS: InventoryAnalyticsResponse = {
  from: "2026-07-01",
  to: "2026-08-01",
  totalDays: 31,
  totalSides: 0,
  totalSideDays: 0,
  occupiedSideDays: 0,
  occupancyRate: 0,
  plannedRevenue: 0,
  freeSides: 0,
  bookingsCount: 0,
  bookingsWithoutPrice: 0,
  constructions: [],
};

function user(role: "admin" | "manager"): SessionUser {
  return { id: "u1", email: "u@example.com", name: null, role, mustChangePassword: false };
}

function renderAnalytics(role: "admin" | "manager") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsView user={user(role)} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  spyOn(api, "getAnalytics").mockResolvedValue(EMPTY_ANALYTICS);
  spyOn(api, "inventoryAnalytics").mockResolvedValue(EMPTY_INVENTORY_ANALYTICS);
  spyOn(api, "listSources").mockResolvedValue([]);
  spyOn(api, "partnerAnalytics").mockResolvedValue({
    from: EMPTY_ANALYTICS.from,
    to: EMPTY_ANALYTICS.to,
    rows: [],
  } as Awaited<ReturnType<typeof api.partnerAnalytics>>);
});

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("AnalyticsView (вкладки)", () => {
  test("admin: вкладки инвентаря, заявок и риелторов; по умолчанию «Инвентарь»", async () => {
    renderAnalytics("admin");
    expect(screen.getByRole("tab", { name: "Инвентарь" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Заявки" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Партнёры" })).toBeTruthy();
    expect(await screen.findByText("Плановая выручка")).toBeTruthy();
    expect(screen.queryByText("Всего заявок")).toBeNull();
    expect(screen.queryByText(/Приведённые лиды и сделки/)).toBeNull();
  });

  test("admin: клик по «Риелторы» переключает на партнёрскую аналитику", async () => {
    renderAnalytics("admin");
    await screen.findByText("Плановая выручка");

    fireEvent.click(screen.getByRole("tab", { name: "Партнёры" }));

    expect(await screen.findByText(/Приведённые лиды и сделки/)).toBeTruthy();
    expect(screen.queryByText("Всего заявок")).toBeNull();
    expect(screen.getByRole("tab", { name: "Партнёры" }).getAttribute("aria-selected")).toBe("true");
  });

  test("admin: клик по «Заявки» переключает на лидовую аналитику", async () => {
    renderAnalytics("admin");
    await screen.findByText("Плановая выручка");

    fireEvent.click(screen.getByRole("tab", { name: "Заявки" }));

    expect(await screen.findByText("Всего заявок")).toBeTruthy();
    expect(screen.queryByText("Плановая выручка")).toBeNull();
  });

  test("менеджер: «Инвентарь» и «Риелторы», без вкладки «Заявки»", async () => {
    renderAnalytics("manager");
    expect(screen.queryByRole("tab", { name: "Заявки" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Инвентарь" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Партнёры" })).toBeTruthy();
    expect(await screen.findByText("Плановая выручка")).toBeTruthy();
    expect(screen.queryByText("Всего заявок")).toBeNull();
  });
});
