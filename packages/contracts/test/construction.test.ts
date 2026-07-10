import { describe, expect, test } from "bun:test";
import { slugify } from "../src/common";
import {
  pricePerMonthLabel,
  upsertConstructionSchema,
} from "../src/construction";

describe("slugify", () => {
  test("транслит рус→лат + дефисы", () => {
    expect(slugify("Сити-формат Грозный")).toBe("siti-format-groznyy");
  });

  test("нижний регистр, схлопывание разделителей, обрезка краёв", () => {
    expect(slugify("  Щит «Проспект Путина» №14  ")).toBe(
      "schit-prospekt-putina-no14",
    );
  });

  test("из одних символов — пустая строка (вызов подставит запасной)", () => {
    expect(slugify("«»—!")).toBe("");
  });
});

describe("pricePerMonthLabel", () => {
  // Intl.NumberFormat("ru-RU") разделяет разряды неразрывным пробелом
  // (U+00A0 или узкий U+202F, зависит от версии ICU) — нормализуем в обычный
  // пробел, чтобы тест не зависел от окружения.
  const norm = (s: string) => s.replace(/[  ]/g, " ");

  test("цена за месяц с разделением разрядов + суффикс", () => {
    expect(norm(pricePerMonthLabel(45_000))).toBe("45 000 ₽/мес");
    expect(norm(pricePerMonthLabel(120_000))).toBe("120 000 ₽/мес");
  });

  test("null → цена по запросу", () => {
    expect(pricePerMonthLabel(null)).toBe("Цена по запросу");
  });
});

describe("upsertConstructionSchema — обязательность по состоянию", () => {
  const cover = {
    images: [{ kind: "new" as const, uploadIndex: 0 }],
    coverIndex: 0,
  };

  test("черновик: достаточно названия", () => {
    expect(
      upsertConstructionSchema.safeParse({ name: "СФ-014", status: "draft" })
        .success,
    ).toBe(true);
  });

  test("обычная публикация: требует адрес, гео и фото, но цена может быть по запросу", () => {
    const res = upsertConstructionSchema.safeParse({
      name: "СФ-014",
      status: "published",
      ...cover,
    });
    expect(res.success).toBe(false);
    const fields = res.success ? [] : res.error.issues.map((i) => i.path[0]);
    for (const f of ["address", "lat"]) {
      expect(fields).toContain(f);
    }
    expect(fields).not.toContain("pricePerMonth");
  });

  test("обычная публикация: полный набор с ценой проходит", () => {
    const res = upsertConstructionSchema.safeParse({
      name: "Сити-формат на пр. Путина, 14",
      status: "published",
      address: "Грозный, пр. В. Путина, 14",
      lat: 43.317,
      lng: 45.694,
      pricePerMonth: 45_000,
      format: "cityFormat",
      lighting: "internal",
      ...cover,
    });
    expect(res.success).toBe(true);
  });

  test("обычная публикация: без цены проходит как цена по запросу", () => {
    const res = upsertConstructionSchema.safeParse({
      name: "Сити-формат без цены",
      status: "published",
      address: "Грозный, пр. В. Путина, 14",
      lat: 43.317,
      lng: 45.694,
      format: "cityFormat",
      lighting: "internal",
      ...cover,
    });
    expect(res.success).toBe(true);
  });

  test("трёхсторонняя конструкция с параметрами сторон проходит", () => {
    const res = upsertConstructionSchema.safeParse({
      name: "Пилон A/B/C",
      status: "published",
      address: "Грозный, Черноречье",
      lat: 43.287,
      lng: 45.679,
      sideCount: 3,
      sides: [
        { code: "A", description: "к центру", trafficPerDay: 18000 },
        { code: "B", description: "к выезду", pricePerMonth: 42000 },
        { code: "C", description: "пешеходная", grp: 1.2 },
      ],
      format: "pillar",
      lighting: "external",
      ...cover,
    });
    expect(res.success).toBe(true);
  });

  test("сторону вне выбранного количества сторон не принимает", () => {
    const res = upsertConstructionSchema.safeParse({
      name: "СФ-014",
      status: "draft",
      sideCount: 2,
      sides: [{ code: "C" }],
    });
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.path.join("."))).toContain(
      "sides.0.code",
    );
  });

  test("фото стороны должно ссылаться на итоговую галерею", () => {
    const res = upsertConstructionSchema.safeParse({
      name: "СФ-014",
      status: "draft",
      sideCount: 1,
      images: [{ kind: "new", uploadIndex: 0 }],
      sides: [{ code: "A", photoIndex: 2 }],
    });
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.path.join("."))).toContain(
      "sides.0.photoIndex",
    );
  });

  test("одна координата без пары → ошибка", () => {
    const res = upsertConstructionSchema.safeParse({
      name: "СФ-014",
      status: "draft",
      lat: 43.317,
    });
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.path[0])).toContain(
      "lng",
    );
  });

  test("обложка вне набора фото → ошибка coverIndex", () => {
    const res = upsertConstructionSchema.safeParse({
      name: "СФ-014",
      status: "draft",
      images: [{ kind: "new", uploadIndex: 0 }],
      coverIndex: 5,
    });
    expect(res.success).toBe(false);
    expect(res.success ? [] : res.error.issues.map((i) => i.path[0])).toContain(
      "coverIndex",
    );
  });
});
