import { describe, expect, test } from "bun:test";
import {
  SITE_SETTINGS_DEFAULTS,
  SITE_SETTINGS_LIMITS,
  deriveSecondaryContact,
  formatPhoneRu,
  orderHomepageProjects,
  resolveSiteSettings,
  updateSiteSettingsSchema,
} from "../src/site-settings";

describe("resolveSiteSettings", () => {
  test("без переопределений — чистые дефолты", () => {
    expect(resolveSiteSettings(undefined)).toEqual(SITE_SETTINGS_DEFAULTS);
    expect(resolveSiteSettings({})).toEqual(SITE_SETTINGS_DEFAULTS);
  });

  test("переопределение перекрывает дефолт, пустая строка — нет", () => {
    const r = resolveSiteSettings({ navCatalog: "Объекты", navFlats: "" });
    expect(r.navCatalog).toBe("Объекты");
    expect(r.navFlats).toBe(SITE_SETTINGS_DEFAULTS.navFlats);
  });

  test("legacy-ключи (бывшие флаги инструментов) в сохранённом JSON игнорируются", () => {
    const r = resolveSiteSettings({ toolPlans: true } as never);
    expect(r).toEqual(SITE_SETTINGS_DEFAULTS);
  });
});

describe("formatPhoneRu / deriveSecondaryContact", () => {
  test("нормализованный → маска показа", () => {
    expect(formatPhoneRu("+79280009300")).toBe("+7 (928) 000-93-00");
  });

  test("email по умолчанию ведёт на mailto адреса из настроек", () => {
    const c = deriveSecondaryContact(resolveSiteSettings({}));
    expect(c.kind).toBe("email");
    expect(c.href).toBe(`mailto:${SITE_SETTINGS_DEFAULTS.email}`);
    expect(c.label).toBe("Написать на почту");
  });

  test("whatsapp → wa.me + подпись по умолчанию", () => {
    const c = deriveSecondaryContact(
      resolveSiteSettings({ secondaryContactKind: "whatsapp", secondaryContactValue: "+7 (928) 000-93-00" }),
    );
    expect(c.href).toBe("https://wa.me/79280009300");
    expect(c.label).toBe("Написать в WhatsApp");
  });

  test("telegram нормализует @/ссылку в t.me/<handle>", () => {
    expect(
      deriveSecondaryContact(
        resolveSiteSettings({ secondaryContactKind: "telegram", secondaryContactValue: "@noesis" }),
      ).href,
    ).toBe("https://t.me/noesis");
    expect(
      deriveSecondaryContact(
        resolveSiteSettings({ secondaryContactKind: "telegram", secondaryContactValue: "https://t.me/noesis" }),
      ).href,
    ).toBe("https://t.me/noesis");
  });

  test("произвольная подпись переопределяет дефолтную", () => {
    const c = deriveSecondaryContact(
      resolveSiteSettings({
        secondaryContactKind: "link",
        secondaryContactValue: "https://vk.com/noesis",
        secondaryContactLabel: "Мы во ВКонтакте",
      }),
    );
    expect(c.href).toBe("https://vk.com/noesis");
    expect(c.label).toBe("Мы во ВКонтакте");
  });
});

describe("orderHomepageProjects", () => {
  const p = (id: string) => ({ id });

  test("скрытые убираются, перечисленные — первыми в заданном порядке", () => {
    const projects = [p("a"), p("b"), p("c"), p("d")];
    const out = orderHomepageProjects(projects, ["c", "a"], ["b"]);
    expect(out.map((x) => x.id)).toEqual(["c", "a", "d"]);
  });

  test("мёртвые id в порядке игнорируются", () => {
    const out = orderHomepageProjects([p("a"), p("b")], ["zzz", "b"], []);
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });

  test("без настроек — исходный порядок", () => {
    const out = orderHomepageProjects([p("a"), p("b")], [], []);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("updateSiteSettingsSchema (гайдрейлы)", () => {
  test("пустые строки выкидываются препроцессом (очистка → дефолт)", () => {
    const out = updateSiteSettingsSchema.parse({ navCatalog: "", email: "" });
    expect(out).toEqual({});
  });

  test("слишком длинная подпись отклоняется", () => {
    const tooLong = "x".repeat(SITE_SETTINGS_LIMITS.navItem + 1);
    expect(() => updateSiteSettingsSchema.parse({ navCatalog: tooLong })).toThrow();
  });

  test("некорректный e-mail отклоняется", () => {
    expect(() => updateSiteSettingsSchema.parse({ email: "не-почта" })).toThrow();
  });

  test("второй контакт-ссылка обязан быть http(s)", () => {
    expect(() =>
      updateSiteSettingsSchema.parse({
        secondaryContactKind: "link",
        secondaryContactValue: "javascript:alert(1)",
      }),
    ).toThrow();
  });

  test("второй контакт не-email без значения отклоняется", () => {
    expect(() =>
      updateSiteSettingsSchema.parse({ secondaryContactKind: "whatsapp" }),
    ).toThrow();
  });

  test("второй контакт-телефон валидируется правилом РФ-номера (не «≥10 цифр»)", () => {
    // Раньше 10 цифр проходили; канон требует 11 с ведущей 7/8.
    expect(() =>
      updateSiteSettingsSchema.parse({
        secondaryContactKind: "phone",
        secondaryContactValue: "1234567890",
      }),
    ).toThrow();
    expect(
      updateSiteSettingsSchema.parse({
        secondaryContactKind: "phone",
        secondaryContactValue: "8 (928) 000-93-00",
      }),
    ).toMatchObject({ secondaryContactValue: "8 (928) 000-93-00" });
  });

  test("newsHomeCount только 3 или 6", () => {
    expect(updateSiteSettingsSchema.parse({ newsHomeCount: 6 })).toMatchObject({ newsHomeCount: 6 });
    expect(() => updateSiteSettingsSchema.parse({ newsHomeCount: 4 })).toThrow();
  });

  test("metrikaCounterId — только цифры", () => {
    expect(updateSiteSettingsSchema.parse({ metrikaCounterId: "12345678" })).toMatchObject({
      metrikaCounterId: "12345678",
    });
    expect(() => updateSiteSettingsSchema.parse({ metrikaCounterId: "abc" })).toThrow();
  });

  test("телефон нормализуется к +7XXXXXXXXXX", () => {
    expect(updateSiteSettingsSchema.parse({ phonePrimary: "8 (928) 000-93-00" })).toMatchObject({
      phonePrimary: "+79280009300",
    });
  });
});
