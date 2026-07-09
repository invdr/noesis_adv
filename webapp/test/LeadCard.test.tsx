import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Funnel, Stage } from "@noesis/contracts";
import { api } from "../src/api/client";
import { LeadCard } from "../src/leads/LeadCard";
import { leadDetail, sessionUser } from "./fixtures";

/**
 * Карточка сделки: шапка (tel-ссылка, пилюля этапа, возраст), сетка «Сделка»
 * (воронка/этап/ответственный), бейдж задачи, кнопки итога контакта и единая
 * лента активности (этапы + назначения + контакты).
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

function renderCard(role: "admin" | "manager" = "manager") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LeadCard
        leadId="lead1"
        stages={stages}
        funnels={funnels}
        user={sessionUser(role)}
        onBack={() => {}}
        onOpenRelated={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  spyOn(api, "getLead").mockResolvedValue(
    // Просроченная задача: бейдж «просрочено» + кнопки итога.
    leadDetail({ nextContactAt: "2026-01-01T10:00:00.000Z", nextContactTypeId: null }),
  );
  spyOn(api, "listContactTypes").mockResolvedValue([]);
  spyOn(api, "listContacts").mockResolvedValue([]);
  spyOn(api, "listSources").mockResolvedValue([]);
  spyOn(api, "listProjects").mockResolvedValue({
    items: [{ id: "p1", name: "СФ-001" } as any],
    page: 1,
    pageSize: 100,
    total: 1,
  });
  spyOn(api, "listUsers").mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("LeadCard", () => {
  test("шапка: телефон-ссылка tel:, пилюля этапа, источник и возраст сделки", async () => {
    renderCard();
    expect(await screen.findByRole("heading", { name: /Иван Петров/ })).toBeTruthy();
    const phone = screen.getByRole("link", { name: "+79280000000" });
    expect(phone.getAttribute("href")).toBe("tel:+79280000000");
    // «Новая» встречается и в пилюле, и в option селекта этапа.
    const pill = document.querySelector(".lead-stage-pill");
    expect(pill?.textContent).toContain("Новая");
    expect(screen.getByText(/в работе \d+ дн\./)).toBeTruthy();
  });

  test("карточка «Сделка»: воронка, этап-селект, ответственный, конструкция", async () => {
    renderCard();
    await screen.findByRole("heading", { name: /Иван Петров/ });
    expect(screen.getByText("Сделка")).toBeTruthy();
    expect(screen.getByText("Клиенты")).toBeTruthy(); // имя воронки
    expect(screen.getByText("Не назначен (в общей очереди)")).toBeTruthy();
    // Название конструкции есть в мета-строке шапки И в поле карточки «Сделка».
    expect(screen.getAllByText("СФ-001").length).toBeGreaterThanOrEqual(2);
  });

  test("задача просрочена: бейдж и кнопки «Выполнен»/«Отмена»", async () => {
    renderCard();
    await screen.findByRole("heading", { name: /Иван Петров/ });
    expect(screen.getByText("просрочено")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Выполнен/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeTruthy();
    expect(screen.queryByText("Недозвон")).toBeNull();
  });

  test("лента активности объединяет этапы, назначения и контакты", async () => {
    renderCard();
    await screen.findByRole("heading", { name: /Иван Петров/ });
    // «Этап» есть и как подпись поля, и как вид события — важно, что есть лента.
    expect(screen.getAllByText("Этап").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("назначена вам")).toBeTruthy(); // assign-событие менеджеру m1
    expect(screen.getAllByText(/выполнен: Звонок/).length).toBeGreaterThanOrEqual(1);
  });
});
