import { describe, expect, test } from "bun:test";
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  PASSWORD_MIN_LENGTH,
} from "../src/auth";

describe("loginRequestSchema", () => {
  test("нормализует email к нижнему регистру и тримит", () => {
    const result = loginRequestSchema.parse({
      email: "  Manager@NOESIS.RU ",
      password: "secret",
    });
    expect(result.email).toBe("manager@noesis.ru");
  });

  test("отклоняет некорректный email", () => {
    expect(() =>
      loginRequestSchema.parse({ email: "not-an-email", password: "secret" }),
    ).toThrow();
  });

  test("требует непустой пароль", () => {
    expect(() =>
      loginRequestSchema.parse({ email: "a@b.ru", password: "" }),
    ).toThrow();
  });
});

describe("changePasswordRequestSchema", () => {
  test("принимает пароль не короче минимальной длины", () => {
    const password = "x".repeat(PASSWORD_MIN_LENGTH);
    const result = changePasswordRequestSchema.parse({
      currentPassword: "old",
      newPassword: password,
    });
    expect(result.newPassword).toBe(password);
  });

  test("отклоняет слишком короткий новый пароль", () => {
    expect(() =>
      changePasswordRequestSchema.parse({
        currentPassword: "old",
        newPassword: "x".repeat(PASSWORD_MIN_LENGTH - 1),
      }),
    ).toThrow();
  });
});
