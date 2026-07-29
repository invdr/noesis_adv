import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { ContactsView } from "../src/contacts/ContactsView";
import { contact, sessionUser } from "./fixtures";

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContactsView user={sessionUser("manager")} />
    </QueryClientProvider>,
  );
}

/**
 * Поле по подписи. `Field` рисует подпись как `<div className="field-label">`,
 * а не как `<label for>`, поэтому getByLabelText здесь не работает: подписи с
 * полями не связаны. Это отдельная проблема доступности — читалка не назовёт
 * поле; здесь просто идём по структуре, чтобы не расширять правку.
 */
function fieldInput(label: string): HTMLInputElement {
  const labelNode = screen.getByText(label, { selector: ".field-label" });
  const input = labelNode.parentElement?.querySelector("input");
  if (!input) throw new Error(`Не найден input у поля «${label}»`);
  return input as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("ContactsView", () => {
  test("редактор клиента переключается на выбранную строку перед сохранением", async () => {
    spyOn(api, "listContacts").mockResolvedValue([
      contact({
        id: "c1",
        fullName: "Иван Первый",
        phone: "+79280000000",
        updatedAt: "2026-06-01T10:00:00.000Z",
      }),
      contact({
        id: "c2",
        fullName: "Мария Вторая",
        phone: "+79991112233",
        updatedAt: "2026-06-02T10:00:00.000Z",
      }),
    ]);

    renderView();
    await screen.findByRole("button", { name: "Иван Первый" });

    const editButtons = screen.getAllByRole("button", { name: "Изменить" });
    fireEvent.click(editButtons[0]!);
    expect(screen.getByDisplayValue("Иван Первый")).toBeTruthy();

    fireEvent.click(editButtons[1]!);
    expect(screen.getByDisplayValue("Мария Вторая")).toBeTruthy();
    expect(screen.queryByDisplayValue("Иван Первый")).toBeNull();
  });

  /**
   * Связки полей паспорта и реквизитов.
   *
   * `IndividualFields`/`CompanyFields` получают значения и сеттеры одним
   * мешком `Record<string, string | Setter>` и достают их строковым поиском
   * (`props["set" + Capitalize(name)]`). Переименование или добавление поля
   * при этом компилируется чисто, а ломается только в рантайме: обработчик
   * падает с «set(...) is not a function», либо `undefined` молча превращает
   * контролируемый input в неконтролируемый. Тест фиксирует, что связки живы,
   * и ловит оба отказа до того, как их увидит пользователь.
   */
  test("паспортные поля физлица связаны со своими сеттерами", async () => {
    spyOn(api, "listContacts").mockResolvedValue([
      contact({ id: "c1", fullName: "Иван Первый", type: "individual" }),
    ]);

    renderView();
    await screen.findByRole("button", { name: "Иван Первый" });
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0]!);

    const series = fieldInput("Серия");
    fireEvent.change(series, { target: { value: "9600" } });
    expect(screen.getByDisplayValue("9600")).toBeTruthy();

    const issuedBy = fieldInput("Кем выдан");
    fireEvent.change(issuedBy, { target: { value: "ОВД Грозного" } });
    expect(screen.getByDisplayValue("ОВД Грозного")).toBeTruthy();
  });

  test("реквизиты компании связаны со своими сеттерами", async () => {
    spyOn(api, "listContacts").mockResolvedValue([
      contact({ id: "c2", fullName: "ООО «Клиент»", type: "company" }),
    ]);

    renderView();
    await screen.findByRole("button", { name: "ООО «Клиент»" });
    fireEvent.click(screen.getAllByRole("button", { name: "Изменить" })[0]!);

    const inn = fieldInput("ИНН");
    fireEvent.change(inn, { target: { value: "2000000000" } });
    expect(screen.getByDisplayValue("2000000000")).toBeTruthy();

    const director = fieldInput("ФИО руководителя");
    fireEvent.change(director, { target: { value: "Иванов И.И." } });
    expect(screen.getByDisplayValue("Иванов И.И.")).toBeTruthy();
  });
});
