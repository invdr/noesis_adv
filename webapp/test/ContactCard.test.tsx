import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { ContactCard } from "../src/contacts/ContactCard";
import { contactDetail } from "./fixtures";

/** Карточка контакта: клиент со своими заявками, партнёр — с приведёнными. */

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContactCard contactId="c1" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("ContactCard", () => {
  beforeEach(() => {
    spyOn(api, "getContact").mockResolvedValue(contactDetail());
  });

  test("клиент: шапка с tel-ссылкой и таблица его заявок", async () => {
    renderCard();
    expect(await screen.findByRole("heading", { name: /Иван Петров/ })).toBeTruthy();
    expect(screen.getByText("Клиент")).toBeTruthy();
    const phone = screen.getByRole("link", { name: "+79280000000" });
    expect(phone.getAttribute("href")).toBe("tel:+79280000000");
    expect(screen.getByText(/Заявки клиента \(1\)/)).toBeTruthy();
    expect(screen.getByText("Главная форма")).toBeTruthy();
    expect(screen.getByText("ЖК «Башня»")).toBeTruthy();
  });

  test("клиент: показывает заполненные паспортные данные", async () => {
    spyOn(api, "getContact").mockResolvedValue(
      contactDetail({
        birthDate: "1990-02-03",
        birthPlace: "г. Махачкала",
        passportSeries: "8212",
        passportNumber: "123456",
        passportIssuedBy: "УМВД России",
        passportIssuedAt: "2020-04-05",
        passportDepartmentCode: "050-001",
        registrationAddress: "г. Махачкала, ул. Ленина, 1",
        actualAddress: "г. Махачкала, ул. Ленина, 2",
      }),
    );
    renderCard();
    expect(await screen.findByText("Паспортные данные")).toBeTruthy();
    expect(screen.getByText("1990-02-03")).toBeTruthy();
    expect(screen.getByText("УМВД России")).toBeTruthy();
    expect(screen.getByText("г. Махачкала, ул. Ленина, 2")).toBeTruthy();
  });

  test("партнёр: заголовок «Приведённые заявки» и агентство в шапке", async () => {
    spyOn(api, "getContact").mockResolvedValue(
      contactDetail({
        kind: "realtor",
        fullName: "Пётр Риелтор",
        agencyName: "АН «Дом»",
        leads: [],
        referredLeads: contactDetail().leads,
      }),
    );
    renderCard();
    expect(await screen.findByRole("heading", { name: /Пётр Риелтор/ })).toBeTruthy();
    expect(screen.getByText("Риелтор")).toBeTruthy();
    expect(screen.getByText(/агентство: АН «Дом»/)).toBeTruthy();
    expect(screen.getByText(/Приведённые заявки \(1\)/)).toBeTruthy();
  });

  test("контакт не найден — сообщение об ошибке", async () => {
    spyOn(api, "getContact").mockRejectedValue(new Error("Контакт не найден"));
    renderCard();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Контакт не найден")).toBeTruthy();
  });
});
