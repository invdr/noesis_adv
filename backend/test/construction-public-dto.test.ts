import { describe, expect, test } from "bun:test";
import type { Runtime } from "../src/runtime";
import {
  getPublicConstructionBySlug,
  listPublicConstructions,
} from "../src/constructions/construction-service";
import { publicConstructionInclude } from "../src/constructions/construction-dto";

/**
 * Границa публичной выдачи конструкций. У владельца сети (`Developer`) есть
 * договорные реквизиты — ИНН/КПП/ОГРН, адреса, банк, р/с и к/с, директор. Они
 * заведены под будущие документы и на анонимных `/api/public/constructions*`
 * появляться не должны. Регрессия здесь бесшумная: реквизиты просто начинают
 * отдаваться наружу и запекаться в статическую сборку сайта, поэтому проверяем
 * и форму ответа, и сам include, которым сервис ходит в БД.
 */

/** Поля владельца, которых не должно быть в анонимной выдаче. */
const REQUISITE_FIELDS = [
  "legalName",
  "inn",
  "kpp",
  "ogrn",
  "legalAddress",
  "postalAddress",
  "bankName",
  "bankBik",
  "bankAccount",
  "correspondentAccount",
  "directorTitle",
  "directorFullName",
  "directorBasis",
] as const;

/** Строка владельца, как её вернула бы БД при широком include. */
function ownerRowWithRequisites() {
  return {
    id: "dev_1",
    name: "Ноэзис",
    slug: "noesis",
    logo: null,
    legalName: 'ООО "Ноэзис"',
    inn: "2000000000",
    kpp: "200001001",
    ogrn: "1112000000000",
    legalAddress: "г. Грозный, пр. Путина, 1",
    postalAddress: "364000, г. Грозный, а/я 1",
    bankName: "АО «Банк»",
    bankBik: "044525225",
    bankAccount: "40702810900000000001",
    correspondentAccount: "30101810400000000225",
    directorTitle: "Генеральный директор",
    directorFullName: "Иванов Иван Иванович",
    directorBasis: "Устав",
    archivedAt: null,
    order: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function constructionRow(owner: unknown) {
  return {
    id: "c_1",
    slug: "sf-014",
    name: "СФ-014",
    code: "СФ-014",
    owner,
    address: "пр. Путина, 1",
    district: "Ленинский",
    lat: 43.3169,
    lng: 45.6981,
    format: "cityFormat",
    size: "1,2 × 1,8 м",
    sideCount: 2,
    lighting: "internal",
    grp: null,
    trafficPerDay: 12000,
    pricePerMonth: 30000,
    description: null,
    cover: null,
    images: [],
    sides: [],
    badges: null,
    status: "published",
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
}

/** Runtime, запоминающий аргументы запроса, чтобы проверить include. */
function runtime(row: unknown) {
  const calls: any[] = [];
  const rt = {
    env: { FILES_PUBLIC_BASE: "https://example.test/files" },
    prisma: {
      construction: {
        findMany: async (args: any) => {
          calls.push(args);
          return [row];
        },
        findFirst: async (args: any) => {
          calls.push(args);
          return row;
        },
      },
    },
  } as unknown as Runtime;
  return { rt, calls };
}

describe("публичная выдача конструкций", () => {
  test("список не отдаёт реквизиты владельца, даже если БД их вернула", async () => {
    // Строка приходит с реквизитами — то есть DTO обязан отфильтровать сам,
    // а не полагаться только на узкий select.
    const { rt } = runtime(constructionRow(ownerRowWithRequisites()));

    const [item] = await listPublicConstructions(rt);

    expect(item?.owner).toEqual({
      id: "dev_1",
      name: "Ноэзис",
      slug: "noesis",
      logo: undefined,
    });
    for (const field of REQUISITE_FIELDS) {
      expect(JSON.stringify(item)).not.toContain(field);
    }
  });

  test("страница по slug не отдаёт реквизиты владельца", async () => {
    const { rt } = runtime(constructionRow(ownerRowWithRequisites()));

    const item = await getPublicConstructionBySlug(rt, "sf-014");

    expect(item?.owner?.name).toBe("Ноэзис");
    const serialized = JSON.stringify(item);
    for (const field of REQUISITE_FIELDS) {
      expect(serialized).not.toContain(field);
    }
    expect(serialized).not.toContain("40702810900000000001");
  });

  test("публичные витрины ходят в БД узким include по владельцу", async () => {
    const { rt, calls } = runtime(constructionRow(null));

    await listPublicConstructions(rt);
    await getPublicConstructionBySlug(rt, "sf-014");

    for (const args of calls) {
      expect(args.include).toBe(publicConstructionInclude);
    }
    // select, а не include: новое поле в Developer не утечёт само собой.
    expect(Object.keys(publicConstructionInclude.owner.select).sort()).toEqual([
      "id",
      "logo",
      "name",
      "slug",
    ]);
  });

  test("конструкция без владельца отдаётся без owner", async () => {
    const { rt } = runtime(constructionRow(null));

    const [item] = await listPublicConstructions(rt);

    expect(item?.owner).toBeUndefined();
    expect(item?.slug).toBe("sf-014");
  });
});
