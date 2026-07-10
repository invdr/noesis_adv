import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../src/api/client";
import { BookingsView } from "../src/bookings/BookingsView";
import { lead, sessionUser } from "./fixtures";

const construction = {
  id: "construction1",
  name: "Щит у площади",
  code: "СФ-001",
  sideCount: 1,
  sides: [
    {
      id: "sideA",
      code: "A",
      effectivePricePerMonth: 50_000,
      pricePerMonth: null,
      description: null,
    },
  ],
} as any;

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingsView user={sessionUser("manager")} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mock.restore();
});

describe("BookingsView", () => {
  test("передаёт выбранную заявку при создании брони", async () => {
    spyOn(api, "listAllProjects").mockResolvedValue({
      items: [construction],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    spyOn(api, "listAllBookings").mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 100,
      total: 0,
    });
    spyOn(api, "listContacts").mockResolvedValue([]);
    spyOn(api, "listAllLeads").mockResolvedValue({
      items: [lead()],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    spyOn(api, "listBookingBrands").mockResolvedValue([]);
    spyOn(api, "listBookingServiceReasons").mockResolvedValue([]);
    const create = spyOn(api, "createBooking").mockResolvedValue({} as any);

    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /Новая бронь/ }));

    const label = await screen.findByText("Заявка (необязательно)");
    const select = label.parentElement?.querySelector("select");
    expect(select).not.toBeNull();
    await screen.findByRole("option", { name: /Иван Петров/ });
    fireEvent.change(select!, { target: { value: "lead1" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ leadId: "lead1" }));
    });
  });
});
