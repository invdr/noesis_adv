import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Funnel, Stage } from "@noesis/contracts";
import { api } from "../src/api/client";
import { LeadsView } from "../src/leads/LeadsView";
import { lead, sessionUser } from "./fixtures";

/**
 * Список заявок: колонки «ЖК»/«След. контакт», фильтр ответственного у админа
 * против чекбокса «Только мои» у менеджера, источники из справочника.
 */

const stages: Stage[] = [
  {
    id: "s_new",
    name: "Новая",
    funnelId: "f1",
    order: 1,
    kind: "in_progress",
    color: "blue",
    isEntry: true,
    isArchived: false,
  },
];
const funnels: Funnel[] = [
  { id: "f1", name: "Клиенты", order: 1, isDefault: true, isArchived: false },
];

function renderLeads(role: "admin" | "manager") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LeadsView
        stages={stages}
        funnels={funnels}
        user={sessionUser(role)}
        expired={false}
        onOpenLead={() => {}}
        onCloseLead={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  spyOn(api, "stats").mockResolvedValue({ total: 1, byStage: { s_new: 1 }, bySource: {} });
  spyOn(api, "listLeads").mockResolvedValue({
    items: [lead({ nextContactAt: "2026-01-01T10:00:00.000Z" })],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  spyOn(api, "listUsers").mockResolvedValue([]);
  spyOn(api, "listProjects").mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });
  spyOn(api, "listSources").mockResolvedValue([
    { id: "hero_form", name: "Главная форма", order: 1, isSystem: true, isWeb: true, isArchived: false },
  ]);
});

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("LeadsView", () => {
  test("таблица: колонки ЖК и «След. контакт», имя источника и просрочка", async () => {
    renderLeads("manager");
    expect(await screen.findByText("Иван Петров")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "ЖК" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "След. контакт" })).toBeTruthy();
    expect(screen.getByText("ЖК «Башня»")).toBeTruthy();
    // «Главная форма» есть и в фильтре-селекте, и в ячейке строки.
    expect(screen.getAllByText("Главная форма").length).toBeGreaterThanOrEqual(2);
    // Просроченная дата контакта выводится (подсветку цветом не проверяем).
    expect(screen.getByText(/01\.01\.2026/)).toBeTruthy();
  });

  test("менеджер видит чекбокс «Только мои», а не селект ответственного", async () => {
    renderLeads("manager");
    await screen.findByText("Иван Петров");
    expect(screen.getByLabelText(/Только мои/)).toBeTruthy();
    expect(screen.queryByText("Не назначен (очередь)")).toBeNull();
  });

  test("админ видит селект «Ответственный» с опцией очереди", async () => {
    renderLeads("admin");
    await screen.findByText("Иван Петров");
    expect(screen.queryByLabelText(/Только мои/)).toBeNull();
    expect(screen.getByText("Не назначен (очередь)")).toBeTruthy();
  });
});
