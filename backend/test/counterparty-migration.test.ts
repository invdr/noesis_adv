import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(import.meta.dir, "../prisma/migrations/20260711051739_counterparties_and_requisites/migration.sql"),
  "utf8",
);

describe("counterparties migration", () => {
  test("переносит старые роли и компанию до удаления устаревших колонок", () => {
    const updateAt = migration.indexOf('UPDATE "Contact"');
    const dropAt = migration.indexOf('DROP COLUMN "agencyId"');
    expect(updateAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(updateAt);
    expect(migration).toContain('WHEN "kind" = \'agency\' THEN \'company\'');
    expect(migration).toContain('"isClient" = ("kind" = \'client\')');
    expect(migration).toContain('"isPartner" = ("kind" IN (\'realtor\', \'agency\'))');
    expect(migration).toContain('"organizationId" = "agencyId"');
    expect(migration).toContain('"legalName" = CASE WHEN "kind" = \'agency\' THEN "companyName"');
  });
});
