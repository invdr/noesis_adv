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
});
