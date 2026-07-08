import { describe, expect, test } from "bun:test";
import {
  EMPTY_PROJECT_TOOLS,
  normalizeProjectTools,
  priceFromLabel,
  projectToolsSchema,
  roomsToLabel,
  roomsToShortLabel,
  slugify,
  upsertProjectSchema,
} from "../src/project";

describe("инструменты «Выбор квартиры» (projectTools)", () => {
  test("ссылка обязана быть http(s)", () => {
    expect(
      projectToolsSchema.safeParse({
        chessboardUrl: "https://chess.example.com/tower",
        plansUrl: null,
        tour3dUrl: null,
      }).success,
    ).toBe(true);
    expect(
      projectToolsSchema.safeParse({
        chessboardUrl: "javascript:alert(1)",
        plansUrl: null,
        tour3dUrl: null,
      }).success,
    ).toBe(false);
  });

  test("normalizeProjectTools: legacy `{}`/мусор → всё выключено", () => {
    expect(normalizeProjectTools({})).toEqual(EMPTY_PROJECT_TOOLS);
    expect(normalizeProjectTools(null)).toEqual(EMPTY_PROJECT_TOOLS);
    expect(normalizeProjectTools("junk")).toEqual(EMPTY_PROJECT_TOOLS);
    expect(normalizeProjectTools({ plansUrl: "https://p.example.com" })).toEqual({
      ...EMPTY_PROJECT_TOOLS,
      plansUrl: "https://p.example.com",
    });
  });
});

describe("slugify", () => {
  test("транслит рус→лат + дефисы", () => {
    expect(slugify("Грозный Тауэр")).toBe("groznyy-tauer");
  });

  test("нижний регистр, схлопывание разделителей, обрезка краёв", () => {
    expect(slugify("  ЖК «Сердце Кавказа» №1  ")).toBe("zhk-serdce-kavkaza-no1");
  });

  test("из одних символов — пустая строка (вызов подставит запасной)", () => {
    expect(slugify("«»—!")).toBe("");
  });
});

describe("roomsToLabel", () => {
  test("студии + непрерывный ряд → диапазон", () => {
    expect(roomsToLabel(["studio", "one", "two", "three"])).toBe(
      "Студии, 1–3 комнатные",
    );
  });

  test("один формат", () => {
    expect(roomsToLabel(["two"])).toBe("2-комнатные");
    expect(roomsToLabel(["fourPlus"])).toBe("4+ комнатные");
  });

  test("разрыв ряда → перечисление", () => {
    expect(roomsToLabel(["one", "three"])).toBe("1, 3 комнатные");
  });
});

describe("roomsToShortLabel", () => {
  test("короткая форма каталога 1:1", () => {
    expect(roomsToShortLabel(["one", "two", "three"])).toBe("1к, 2к, 3к");
    expect(roomsToShortLabel(["studio", "one", "two", "three"])).toBe(
      "Ст, 1к, 2к, 3к",
    );
  });

  test("порядок нормализуется, дубли отсекаются", () => {
    expect(roomsToShortLabel(["two", "one"])).toBe("1к, 2к");
  });

  test("пустой набор → пустая строка", () => {
    expect(roomsToShortLabel([])).toBe("");
  });
});

describe("priceFromLabel", () => {
  test("целые миллионы — без дробной части", () => {
    expect(priceFromLabel(1_000_000)).toBe("от 1 млн ₽");
  });

  test("десятые — через запятую", () => {
    expect(priceFromLabel(3_700_000)).toBe("от 3,7 млн ₽");
    expect(priceFromLabel(2_600_000)).toBe("от 2,6 млн ₽");
  });

  test("null → цена по запросу", () => {
    expect(priceFromLabel(null)).toBe("Цена по запросу");
  });
});

describe("upsertProjectSchema — обязательность по состоянию", () => {
  const cover = {
    images: [{ kind: "new" as const, uploadIndex: 0 }],
    coverIndex: 0,
  };

  test("черновик: достаточно названия", () => {
    expect(
      upsertProjectSchema.safeParse({ name: "ЖК", status: "draft" }).success,
    ).toBe(true);
  });

  test("«скоро»: нужна обложка", () => {
    const noCover = upsertProjectSchema.safeParse({
      name: "ЖК",
      status: "published",
      comingSoon: true,
    });
    expect(noCover.success).toBe(false);

    const withCover = upsertProjectSchema.safeParse({
      name: "ЖК",
      status: "published",
      comingSoon: true,
      ...cover,
    });
    expect(withCover.success).toBe(true);
  });

  test("обычная публикация: требует полный набор", () => {
    const res = upsertProjectSchema.safeParse({
      name: "ЖК",
      status: "published",
      ...cover,
    });
    expect(res.success).toBe(false);
    const fields = res.success
      ? []
      : res.error.issues.map((i) => i.path[0]);
    for (const f of ["address", "developerId", "priceFrom", "rooms", "description"]) {
      expect(fields).toContain(f);
    }
  });

  test("обычная публикация: полный набор проходит", () => {
    const res = upsertProjectSchema.safeParse({
      name: "ЖК Грозный",
      status: "published",
      address: "Грозный, пр. Путина 1",
      developerId: "dev_1",
      priceFrom: 3_500_000,
      rooms: ["one", "two"],
      description: "Современный комплекс",
      ...cover,
    });
    expect(res.success).toBe(true);
  });

  test("обложка вне набора фото → ошибка coverIndex", () => {
    const res = upsertProjectSchema.safeParse({
      name: "ЖК",
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
