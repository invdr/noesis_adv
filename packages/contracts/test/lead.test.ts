import { describe, expect, test } from "bun:test";
import {
  assignLeadSchema,
  createLeadSchema,
  createManualLeadSchema,
  createNoteSchema,
  listLeadsQuerySchema,
  normalizeRuPhone,
  phoneSchema,
  updateNextContactSchema,
} from "../src/lead";

describe("phoneSchema", () => {
  test("нормализует маску лендинга к +7XXXXXXXXXX", () => {
    expect(phoneSchema.parse("+7 (928) 000-93-00")).toBe("+79280009300");
  });

  test("принимает 8 в начале", () => {
    expect(phoneSchema.parse("8 928 000 93 00")).toBe("+79280009300");
  });

  test("отклоняет неполный номер", () => {
    expect(() => phoneSchema.parse("+7 (928) 000")).toThrow();
  });
});

describe("normalizeRuPhone", () => {
  test("РФ-номер с +7 и 8 приводит к канону", () => {
    expect(normalizeRuPhone("+7 (928) 000-93-00")).toBe("+79280009300");
    expect(normalizeRuPhone("8 928 000 93 00")).toBe("+79280009300");
  });

  test("зарубежный 11-значный номер не выдаёт за РФ (null)", () => {
    // US +1 234 567 8901 → 11 цифр, но ведущая «1» — не РФ, не портим.
    expect(normalizeRuPhone("+1 234 567 8901")).toBeNull();
  });

  test("не-11-значный номер → null", () => {
    expect(normalizeRuPhone("928 000 93 00")).toBeNull();
  });
});

describe("createLeadSchema", () => {
  test("валидная заявка", () => {
    const result = createLeadSchema.parse({
      name: "Иван",
      phone: "+7 (928) 000-93-00",
      consent: true,
    });
    expect(result.phone).toBe("+79280009300");
    expect(result.source).toBe("hero_form");
  });

  test("требует согласие", () => {
    expect(() =>
      createLeadSchema.parse({
        name: "Иван",
        phone: "+7 (928) 000-93-00",
        consent: false,
      }),
    ).toThrow();
  });

  test("требует имя не короче 2 символов", () => {
    expect(() =>
      createLeadSchema.parse({ name: "И", phone: "+79280009300", consent: true }),
    ).toThrow();
  });

  test("принимает honeypot-поле company (валидацию делает сервис)", () => {
    const result = createLeadSchema.parse({
      name: "Иван",
      phone: "+79280009300",
      consent: true,
      company: "бот заполнил",
    });
    expect(result.company).toBe("бот заполнил");
  });
});

describe("assignLeadSchema", () => {
  test("принимает null как возврат в общую очередь", () => {
    expect(assignLeadSchema.parse({ assigneeId: null }).assigneeId).toBeNull();
  });

  test("принимает id ответственного", () => {
    expect(assignLeadSchema.parse({ assigneeId: "u1" }).assigneeId).toBe("u1");
  });
});

describe("createManualLeadSchema", () => {
  const base = { name: "Иван", phone: "+79280009300", consent: true, source: "offline" };

  test("новый реферер нормализует телефон", () => {
    const parsed = createManualLeadSchema.parse({
      ...base,
      newReferrer: { fullName: "Пётр Риелтор", phone: "8 999 111-22-33" },
    });
    expect(parsed.newReferrer?.phone).toBe("+79991112233");
  });

  test("новый реферер принимает международный телефон", () => {
    const parsed = createManualLeadSchema.parse({
      ...base,
      newReferrer: { fullName: "Пётр Риелтор", phone: "+44 20 7946 0958" },
    });
    expect(parsed.newReferrer?.phone).toBe("+44 20 7946 0958");
  });

  test("нельзя одновременно выбрать существующего и создать нового реферера", () => {
    expect(() =>
      createManualLeadSchema.parse({
        ...base,
        referrerId: "r1",
        newReferrer: { fullName: "Пётр Риелтор" },
      }),
    ).toThrow();
  });
});

describe("updateNextContactSchema", () => {
  test("принимает ISO-дату и null", () => {
    expect(
      updateNextContactSchema.parse({ nextContactAt: "2026-06-28T09:00:00.000Z" })
        .nextContactAt,
    ).toBe("2026-06-28T09:00:00.000Z");
    expect(updateNextContactSchema.parse({ nextContactAt: null }).nextContactAt).toBeNull();
  });

  test("отклоняет произвольную строку", () => {
    expect(() => updateNextContactSchema.parse({ nextContactAt: "завтра" })).toThrow();
  });
});

describe("createNoteSchema", () => {
  test("отклоняет пустую заметку", () => {
    expect(() => createNoteSchema.parse({ text: "  " })).toThrow();
  });
});

describe("listLeadsQuerySchema", () => {
  test("дефолты: страница 1, 25 на страницу", () => {
    const q = listLeadsQuerySchema.parse({});
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(25);
  });

  test("приводит строковые query-параметры к числам", () => {
    const q = listLeadsQuerySchema.parse({ page: "2", pageSize: "50" });
    expect(q.page).toBe(2);
    expect(q.pageSize).toBe(50);
  });

  test("источник — произвольный id справочника (живость проверяет сервис)", () => {
    // Источники стали управляемым справочником: фильтр принимает любой id.
    expect(listLeadsQuerySchema.parse({ source: "src_custom1" }).source).toBe("src_custom1");
    expect(() => listLeadsQuerySchema.parse({ source: "" })).toThrow();
  });
});

describe("createLeadSchema: источник публичной формы", () => {
  const base = { name: "Иван", phone: "+79280009300", consent: true as const };

  test("принимает только веб-слаги лендинга (дефолт hero_form)", () => {
    expect(createLeadSchema.parse({ ...base, source: "project" }).source).toBe("project");
    expect(createLeadSchema.parse({ ...base, source: "contacts" }).source).toBe("contacts");
    expect(createLeadSchema.parse(base).source).toBe("hero_form");
  });

  test("оффлайн/кастомный источник с улицы отклоняется", () => {
    expect(() => createLeadSchema.parse({ ...base, source: "offline" })).toThrow();
    expect(() => createLeadSchema.parse({ ...base, source: "src_custom1" })).toThrow();
  });
});
