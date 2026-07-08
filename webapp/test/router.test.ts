import { describe, expect, test } from "bun:test";
import { parseHash } from "../src/router";

/**
 * Юнит на разбор хэша CRM-роутером. Чистая функция `parseHash` — фундамент
 * маршрутов `#/`, `#/<view>`, `#/leads/<id>`.
 */
describe("parseHash", () => {
  test("пустой/дефолтный хэш → пустой view", () => {
    expect(parseHash("")).toEqual({ view: "" });
    expect(parseHash("#")).toEqual({ view: "" });
    expect(parseHash("#/")).toEqual({ view: "" });
  });

  test("раздел без параметра", () => {
    expect(parseHash("#/analytics")).toEqual({ view: "analytics" });
    expect(parseHash("#/contacts")).toEqual({ view: "contacts" });
  });

  test("карточка заявки #/leads/<id>", () => {
    expect(parseHash("#/leads/abc123")).toEqual({ view: "leads", leadId: "abc123" });
  });

  test("карточка контакта #/contacts/<id>", () => {
    expect(parseHash("#/contacts/c42")).toEqual({ view: "contacts", contactId: "c42" });
  });

  test("список заявок без id", () => {
    expect(parseHash("#/leads")).toEqual({ view: "leads" });
  });

  test("id декодируется из URL-энкодинга", () => {
    expect(parseHash("#/leads/a%20b")).toEqual({ view: "leads", leadId: "a b" });
  });

  test("лишние сегменты у раздела без карточек игнорируются", () => {
    expect(parseHash("#/analytics/extra")).toEqual({ view: "analytics" });
  });
});
