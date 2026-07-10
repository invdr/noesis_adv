import { describe, expect, test } from "bun:test";
import {
  createDealDocumentSchema,
  dealDocumentTypeSchema,
  updateDealSchema,
} from "../src/deal";

describe("deal schemas", () => {
  test("createDealDocument: тип по умолчанию — other", () => {
    const res = createDealDocumentSchema.parse({});
    expect(res.type).toBe("other");
    expect(res.name).toBeUndefined();
  });

  test("createDealDocument: принимает известный тип и название", () => {
    const res = createDealDocumentSchema.parse({ type: "contract", name: "  Договор №1  " });
    expect(res.type).toBe("contract");
    expect(res.name).toBe("Договор №1");
  });

  test("createDealDocument: неизвестный тип отклоняется", () => {
    expect(createDealDocumentSchema.safeParse({ type: "invoice2" }).success).toBe(false);
  });

  test("dealDocumentType: полный набор", () => {
    expect(dealDocumentTypeSchema.options).toEqual(["contract", "invoice", "act", "other"]);
  });

  test("updateDeal: требует boolean noDocuments", () => {
    expect(updateDealSchema.safeParse({ noDocuments: true }).success).toBe(true);
    expect(updateDealSchema.safeParse({}).success).toBe(false);
    expect(updateDealSchema.safeParse({ noDocuments: "yes" }).success).toBe(false);
  });
});
