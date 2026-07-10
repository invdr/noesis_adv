import { afterEach, describe, expect, test } from "bun:test";
import { api } from "../src/api/client";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("api.listAllBookings", () => {
  test("загружает все страницы, чтобы календарь не терял занятые периоды", async () => {
    const requestedPages: string[] = [];
    globalThis.fetch = (async (url: string) => {
      const page = new URL(url).searchParams.get("page")!;
      requestedPages.push(page);
      const items =
        page === "1"
          ? Array.from({ length: 100 }, (_, i) => ({ id: `booking-${i}` }))
          : [{ id: "booking-100" }];
      return new Response(
        JSON.stringify({ items, page: Number(page), pageSize: 100, total: 101 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await api.listAllBookings({ from: "2026-07-01", to: "2026-08-01" });

    expect(requestedPages).toEqual(["1", "2"]);
    expect(result.items).toHaveLength(101);
  });
});
