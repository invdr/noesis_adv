import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnalyticsResponse, SessionUser } from "@gsk-tower/contracts";
import { api } from "../src/api/client";
import { AnalyticsView } from "../src/analytics/AnalyticsView";

/**
 * Дымовой тест шелла «Аналитика» с вкладками: admin видит обе («Заявки» +
 * «Риелторы»), менеджер — только «Риелторы» и открывается сразу на ней.
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
  test("admin: обе вкладки, по умолчанию «Заявки»", async () => {
    renderAnalytics("admin");
    expect(screen.getByRole("tab", { name: "Заявки" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Риелторы" })).toBeTruthy();
    // Лидовый дашборд — активная вкладка по умолчанию.
    expect(await screen.findByText("Всего заявок")).toBeTruthy();
    expect(screen.queryByText(/Приведённые лиды и сделки/)).toBeNull();
  });

  test("admin: клик по «Риелторы» переключает на партнёрскую аналитику", async () => {
    renderAnalytics("admin");
    await screen.findByText("Всего заявок");

    fireEvent.click(screen.getByRole("tab", { name: "Риелторы" }));

    expect(await screen.findByText(/Приведённые лиды и сделки/)).toBeTruthy();
    expect(screen.queryByText("Всего заявок")).toBeNull();
    expect(screen.getByRole("tab", { name: "Риелторы" }).getAttribute("aria-selected")).toBe("true");
  });

  test("менеджер: только «Риелторы», без вкладки «Заявки»", async () => {
    renderAnalytics("manager");
    expect(screen.queryByRole("tab", { name: "Заявки" })).toBeNull();
    expect(await screen.findByText(/Приведённые лиды и сделки/)).toBeTruthy();
    expect(screen.queryByText("Всего заявок")).toBeNull();
  });
});
