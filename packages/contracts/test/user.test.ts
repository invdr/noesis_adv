import { describe, expect, test } from "bun:test";
import { createUserSchema, updateUserSchema } from "../src/user";

describe("createUserSchema", () => {
  test("нормализует email и принимает роль", () => {
    const result = createUserSchema.parse({
      email: "  New.Manager@GSK.RU ",
      role: "manager",
    });
    expect(result.email).toBe("new.manager@gsk.ru");
    expect(result.role).toBe("manager");
  });

  test("отклоняет некорректный email", () => {
    expect(() =>
      createUserSchema.parse({ email: "nope", role: "admin" }),
    ).toThrow();
  });

  test("отклоняет неизвестную роль", () => {
    expect(() =>
      createUserSchema.parse({ email: "a@b.ru", role: "superuser" }),
    ).toThrow();
  });
});

describe("updateUserSchema", () => {
  test("принимает частичное обновление роли", () => {
    expect(updateUserSchema.parse({ role: "admin" }).role).toBe("admin");
  });

  test("отклоняет пустой объект (нечего обновлять)", () => {
    expect(() => updateUserSchema.parse({})).toThrow();
  });
});
