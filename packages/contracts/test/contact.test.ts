import { describe, expect, test } from "bun:test";
import { upsertContactSchema } from "../src/contact";

const base = {
  type: "individual" as const,
  isClient: false,
  isPartner: true,
  fullName: "Иван Петров",
};

describe("upsertContactSchema: телефон", () => {
  test("нормализует ввод к +7XXXXXXXXXX (ключ дедупа с заявками)", () => {
    const parsed = upsertContactSchema.parse({
      ...base,
      phone: "8 (912) 345-67-89",
    });
    expect(parsed.phone).toBe("+79123456789");
  });

  test("null/отсутствие телефона допустимы (телефон необязателен)", () => {
    expect(upsertContactSchema.parse({ ...base, phone: null }).phone).toBeNull();
    expect(upsertContactSchema.parse(base).phone).toBeUndefined();
  });

  test("международный телефон партнёра сохраняется без РФ-нормализации", () => {
    const parsed = upsertContactSchema.parse({
      ...base,
      phone: "+1 555 123 4567",
    });
    expect(parsed.phone).toBe("+1 555 123 4567");
  });

  test("произвольная строка отклоняется", () => {
    const res = upsertContactSchema.safeParse({ ...base, phone: "позвонить после 18" });
    expect(res.success).toBe(false);
  });

  test("неполный номер отклоняется", () => {
    const res = upsertContactSchema.safeParse({ ...base, phone: "+7 912 345" });
    expect(res.success).toBe(false);
  });
});

describe("upsertContactSchema: паспортные данные", () => {
  test("даты принимаются только в формате ГГГГ-ММ-ДД", () => {
    expect(
      upsertContactSchema.parse({
        ...base,
        birthDate: "1990-02-03",
        passportIssuedAt: "2020-04-05",
      }).birthDate,
    ).toBe("1990-02-03");

    const res = upsertContactSchema.safeParse({ ...base, birthDate: "03.02.1990" });
    expect(res.success).toBe(false);
  });

  test("пробельные паспортные поля схлопываются в пустую строку для сервиса", () => {
    const parsed = upsertContactSchema.parse({
      ...base,
      passportSeries: " 8212 ",
      registrationAddress: "   ",
    });
    expect(parsed.passportSeries).toBe("8212");
    expect(parsed.registrationAddress).toBe("");
  });
});

describe("upsertContactSchema: роли и компания", () => {
  test("требует хотя бы одну роль", () => {
    expect(
      upsertContactSchema.safeParse({
        ...base,
        isPartner: false,
        isClient: false,
      }).success,
    ).toBe(false);
  });

  test("не позволяет компании быть представителем другой компании", () => {
    expect(
      upsertContactSchema.safeParse({
        type: "company",
        isClient: false,
        isPartner: true,
        fullName: "ООО Строймедиа",
        organizationId: "another-company",
      }).success,
    ).toBe(false);
  });
});

describe("upsertContactSchema: паспортные даты", () => {
  /**
   * Поля заведены под будущий генератор договорных документов и лежат в БД как
   * `String?`, поэтому невалидная дата не отсеивалась нигде дальше по пути.
   * Своя регулярка проверяла только форму, но не календарь.
   */
  test("несуществующий календарный день отклоняется", () => {
    const res = upsertContactSchema.safeParse({
      ...base,
      birthDate: "2026-02-31",
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["birthDate"]);
  });

  test("заведомо невозможный месяц отклоняется", () => {
    expect(
      upsertContactSchema.safeParse({ ...base, passportIssuedAt: "2026-99-99" })
        .success,
    ).toBe(false);
  });

  test("реальная дата и отсутствие даты допустимы", () => {
    const parsed = upsertContactSchema.parse({
      ...base,
      birthDate: "1990-02-28",
      passportIssuedAt: null,
    });
    expect(parsed.birthDate).toBe("1990-02-28");
    expect(parsed.passportIssuedAt).toBeNull();
  });

  test("високосный день проходит", () => {
    expect(
      upsertContactSchema.safeParse({ ...base, birthDate: "2024-02-29" }).success,
    ).toBe(true);
  });
});
