import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { AgendaView } from "../src/leads/AgendaView";
import { agendaResponse, sessionUser } from "./fixtures";

/** «Мой день»: группы повестки, включая «Без задачи», и пустое состояние. */

function renderAgenda(role: "admin" | "manager" = "manager") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgendaView user={sessionUser(role)} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  spyOn(api, "getAgenda").mockResolvedValue(agendaResponse());
});

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("AgendaView", () => {
  test("показывает группы с бейджами-счётчиками, включая «Без задачи»", async () => {
    renderAgenda();
    expect(await screen.findByText("Просрочено")).toBeTruthy();
    expect(screen.getByText("Сегодня")).toBeTruthy();
    expect(screen.getByText("Без задачи")).toBeTruthy();
    // Пустая группа («Ближайшие 7 дней») не рендерится вовсе.
    expect(screen.queryByText("Ближайшие 7 дней")).toBeNull();
    // Подсказка группы «Без задачи» — зачем она нужна.
    expect(screen.getByText(/назначьте контакт, чтобы заявка не потерялась/)).toBeTruthy();
    // Строки заявок с кликабельными именами.
    expect(screen.getByRole("button", { name: "Клиент over1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Клиент lost1" })).toBeTruthy();
  });

  test("пустая повестка — дружелюбное сообщение", async () => {
    spyOn(api, "getAgenda").mockResolvedValue(
      agendaResponse({ overdue: [], today: [], upcoming: [], noTask: [] }),
    );
    renderAgenda();
    expect(
      await screen.findByText("На ближайшие дни ничего не запланировано."),
    ).toBeTruthy();
  });

  test("подпись повестки зависит от роли", async () => {
    renderAgenda("admin");
    expect(await screen.findByText(/Повестка всей команды/)).toBeTruthy();
  });
});
