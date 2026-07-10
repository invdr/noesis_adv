import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const migrationPath = join(
  import.meta.dir,
  "../prisma/migrations/20260709090000_construction_sides/migration.sql",
);

describe("construction sides migration", () => {
  test("backfills demo side counts before sides and keeps booking-side FK composite", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql.indexOf("UPDATE \"Construction\"\nSET \"sideCount\" = 3")).toBeLessThan(
      sql.indexOf("INSERT INTO \"ConstructionSide\""),
    );
    expect(sql).toContain("COALESCE(b.\"side\", 'A')");
    expect(sql).toContain("Booking_constructionSideId_constructionId_fkey");
    expect(sql).toContain("REFERENCES \"ConstructionSide\"(\"id\", \"constructionId\")");
  });
});
