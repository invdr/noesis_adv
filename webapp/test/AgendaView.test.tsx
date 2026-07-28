import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { AgendaView } from "../src/leads/AgendaView";
import {
  agendaResponse,
  bookingReminderItem,
  bookingReminders,
  sessionUser,
} from "./fixtures";

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
  // Раньше этот запрос не мокали: тест ходил в реальный localhost:3000 (тот
  // самый ECONNREFUSED в логах), блок «Сроки броней» всегда рендерил ветку
  // ошибки, и его регрессии тест не ловил.
  spyOn(api, "getBookingReminders").mockResolvedValue(bookingReminders());
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

describe("AgendaView — блок «Сроки броней»", () => {
  test("показывает брони по группам срочности", async () => {
    spyOn(api, "getBookingReminders").mockResolvedValue(
      bookingReminders({
        overdue: [bookingReminderItem({ id: "b_over", clientName: "Просроченный клиент" })],
        today: [bookingReminderItem({ id: "b_today", clientName: "Сегодняшний клиент" })],
      }),
    );

    renderAgenda();

    expect(await screen.findByText("Сроки броней")).toBeTruthy();
    expect(screen.getByText("Просроченный клиент")).toBeTruthy();
    expect(screen.getByText("Сегодняшний клиент")).toBeTruthy();
    // Пустая группа не рендерится — как и в повестке заявок.
    expect(screen.queryByText("Броней с подходящим сроком нет.")).toBeNull();
  });

  test("нет броней со сроком — явное сообщение, а не пустота", async () => {
    renderAgenda();

    expect(await screen.findByText("Броней с подходящим сроком нет.")).toBeTruthy();
  });

  test("отказ запроса показывает ошибку, а не пустой блок", async () => {
    spyOn(api, "getBookingReminders").mockRejectedValue(new Error("сеть недоступна"));

    renderAgenda();

    // Половина «Моего дня» не должна молча выглядеть как «броней нет».
    expect(await screen.findByText("сеть недоступна")).toBeTruthy();
    expect(screen.queryByText("Броней с подходящим сроком нет.")).toBeNull();
  });
});
