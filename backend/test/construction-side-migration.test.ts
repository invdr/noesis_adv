import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const migrationPath = join(
  import.meta.dir,
  "../prisma/migrations/20260709090000_construction_sides/migration.sql",
);
const initialMigrationPath = join(
  import.meta.dir,
  "../prisma/migrations/20260708000000_init/migration.sql",
);
const reminderClaimMigrationPath = join(
  import.meta.dir,
  "../prisma/migrations/20260710200000_booking_reminder_claim/migration.sql",
);

describe("construction sides migration", () => {
  test("keeps the historical initial schema intact and applies bookings forward", async () => {
    const [initialSql, sql] = await Promise.all([
      readFile(initialMigrationPath, "utf8"),
      readFile(migrationPath, "utf8"),
    ]);

    expect(initialSql).toContain('"side" TEXT');
    expect(initialSql).not.toContain('CREATE TABLE "Booking"');
    expect(initialSql).not.toContain('CREATE TYPE "BookingKind"');
    expect(sql).toContain('ALTER TABLE "Construction" ADD COLUMN "sideCount"');
    expect(sql).toContain('CREATE TYPE "BookingKind"');
    expect(sql).toContain('CREATE TABLE "Booking"');
    expect(sql.indexOf('CREATE TABLE "Booking"')).toBeLessThan(
      sql.indexOf('ALTER TABLE "Booking" ADD COLUMN "constructionSideId"'),
    );
    expect(sql).toContain('ALTER TABLE "Construction" DROP COLUMN "side"');
  });

  test("backfills demo side counts before sides and keeps booking-side FK composite", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql.indexOf("UPDATE \"Construction\"\nSET \"sideCount\" = 3")).toBeLessThan(
      sql.indexOf("INSERT INTO \"ConstructionSide\""),
    );
    expect(sql).toContain("COALESCE(b.\"side\", 'A')");
    expect(sql).toContain("Booking_constructionSideId_constructionId_fkey");
    expect(sql).toContain("REFERENCES \"ConstructionSide\"(\"id\", \"constructionId\")");
  });

  test("adds an expiring reminder-delivery claim as a forward migration", async () => {
    const sql = await readFile(reminderClaimMigrationPath, "utf8");

    expect(sql).toContain('ADD COLUMN "reminderSendingToken" TEXT');
    expect(sql).toContain('ADD COLUMN "reminderSendingAt" TIMESTAMP(3)');
    expect(sql).toContain('CREATE INDEX "Booking_reminderSendingAt_idx"');
  });
});
