import { describe, expect, test } from "bun:test";
import { uniqueSlug } from "../src/http/slug";

describe("uniqueSlug", () => {
  test("свободный slug берётся как есть", async () => {
    expect(await uniqueSlug("Грозный Тауэр", async () => false)).toBe(
      "groznyy-tauer",
    );
  });

  test("занятый — добавляет суффикс до свободного", async () => {
    const taken = new Set(["sf", "sf-2"]);
    expect(await uniqueSlug("СФ", async (s) => taken.has(s))).toBe("sf-3");
  });

  test("пустой slug из имени → fallback", async () => {
    expect(await uniqueSlug("«»—", async () => false, "construction")).toBe("construction");
  });
});
