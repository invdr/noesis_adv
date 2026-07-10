-- CreateTable
CREATE TABLE "ConstructionSide" (
    "id" TEXT NOT NULL,
    "constructionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "pricePerMonth" INTEGER,
    "trafficPerDay" INTEGER,
    "grp" DOUBLE PRECISION,
    "photoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstructionSide_pkey" PRIMARY KEY ("id")
);

-- One-time demo inventory enrichment for already-seeded databases. This runs
-- before side backfill, when live side-level edits cannot exist yet.
UPDATE "Construction"
SET "sideCount" = 3
WHERE "slug" = 'schit-ahmat-arena'
  AND "code" = 'ББ-021'
  AND "sideCount" < 3;

UPDATE "Construction"
SET "sideCount" = 3
WHERE "slug" = 'pilon-chernoreche'
  AND "code" = 'ПЛ-006'
  AND "sideCount" < 3;

-- Backfill A/B/C sides from existing constructions. Side price stays NULL to inherit
-- the construction default; traffic/GRP/photo get the old construction-level values.
INSERT INTO "ConstructionSide" (
    "id",
    "constructionId",
    "code",
    "description",
    "pricePerMonth",
    "trafficPerDay",
    "grp",
    "photoId",
    "createdAt",
    "updatedAt"
)
SELECT
    ('side_' || md5(c."id" || ':A'))::TEXT,
    c."id",
    'A'::TEXT,
    NULL::TEXT,
    NULL::INTEGER,
    c."trafficPerDay",
    c."grp",
    c."coverId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Construction" c
UNION ALL
SELECT
    ('side_' || md5(c."id" || ':B'))::TEXT,
    c."id",
    'B'::TEXT,
    NULL::TEXT,
    NULL::INTEGER,
    c."trafficPerDay",
    c."grp",
    c."coverId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Construction" c
WHERE c."sideCount" >= 2
UNION ALL
SELECT
    ('side_' || md5(c."id" || ':C'))::TEXT,
    c."id",
    'C'::TEXT,
    NULL::TEXT,
    NULL::INTEGER,
    c."trafficPerDay",
    c."grp",
    c."coverId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Construction" c
WHERE c."sideCount" >= 3;

-- One-time descriptions and side overrides for known demo rows. Regular seeds do
-- not update existing constructions, so later manager edits remain authoritative.
UPDATE "ConstructionSide" s
SET "description" = 'к проспекту, поток к центру',
    "trafficPerDay" = 38000,
    "grp" = 2.8
FROM "Construction" c
WHERE s."constructionId" = c."id"
  AND c."slug" = 'siti-format-prospekt-putina'
  AND c."code" = 'СФ-001'
  AND s."code" = 'A';

UPDATE "ConstructionSide" s
SET "description" = 'от центра к Минутке',
    "pricePerMonth" = 42000,
    "trafficPerDay" = 34000,
    "grp" = 2.4
FROM "Construction" c
WHERE s."constructionId" = c."id"
  AND c."slug" = 'siti-format-prospekt-putina'
  AND c."code" = 'СФ-001'
  AND s."code" = 'B';

UPDATE "ConstructionSide" s
SET "description" = 'въезд на площадь',
    "trafficPerDay" = 52000,
    "grp" = 3.4
FROM "Construction" c
WHERE s."constructionId" = c."id"
  AND c."slug" = 'siti-format-ploschad-minutka'
  AND c."code" = 'СФ-014'
  AND s."code" = 'A';

UPDATE "ConstructionSide" s
SET "description" = 'выезд с площади',
    "pricePerMonth" = 49000,
    "trafficPerDay" = 47000,
    "grp" = 3.1
FROM "Construction" c
WHERE s."constructionId" = c."id"
  AND c."slug" = 'siti-format-ploschad-minutka'
  AND c."code" = 'СФ-014'
  AND s."code" = 'B';

UPDATE "ConstructionSide" s
SET "description" = 'в сторону центра района',
    "trafficPerDay" = 18000,
    "grp" = NULL
FROM "Construction" c
WHERE s."constructionId" = c."id"
  AND c."slug" = 'pilon-chernoreche'
  AND c."code" = 'ПЛ-006'
  AND s."code" = 'A';

UPDATE "ConstructionSide" s
SET "description" = 'к выезду из района',
    "trafficPerDay" = 16000,
    "grp" = NULL
FROM "Construction" c
WHERE s."constructionId" = c."id"
  AND c."slug" = 'pilon-chernoreche'
  AND c."code" = 'ПЛ-006'
  AND s."code" = 'B';

UPDATE "ConstructionSide" s
SET "description" = 'пешеходный фасад',
    "trafficPerDay" = 9000,
    "grp" = NULL
FROM "Construction" c
WHERE s."constructionId" = c."id"
  AND c."slug" = 'pilon-chernoreche'
  AND c."code" = 'ПЛ-006'
  AND s."code" = 'C';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "constructionSideId" TEXT;

-- Backfill bookings: legacy NULL side is technical side A.
UPDATE "Booking" b
SET "constructionSideId" = s."id"
FROM "ConstructionSide" s
WHERE s."constructionId" = b."constructionId"
  AND s."code" = COALESCE(b."side", 'A');

-- Defensive fallback to A if legacy data contains an unknown side code.
UPDATE "Booking" b
SET "constructionSideId" = s."id"
FROM "ConstructionSide" s
WHERE b."constructionSideId" IS NULL
  AND s."constructionId" = b."constructionId"
  AND s."code" = 'A';

ALTER TABLE "Booking" ALTER COLUMN "constructionSideId" SET NOT NULL;

-- DropIndex
DROP INDEX IF EXISTS "Booking_side_idx";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "side";

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionSide_constructionId_code_key" ON "ConstructionSide"("constructionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionSide_id_constructionId_key" ON "ConstructionSide"("id", "constructionId");

-- CreateIndex
CREATE INDEX "ConstructionSide_constructionId_idx" ON "ConstructionSide"("constructionId");

-- CreateIndex
CREATE INDEX "ConstructionSide_photoId_idx" ON "ConstructionSide"("photoId");

-- CreateIndex
CREATE INDEX "Booking_constructionSideId_idx" ON "Booking"("constructionSideId");

-- AddForeignKey
ALTER TABLE "ConstructionSide" ADD CONSTRAINT "ConstructionSide_constructionId_fkey" FOREIGN KEY ("constructionId") REFERENCES "Construction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionSide" ADD CONSTRAINT "ConstructionSide_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_constructionSideId_constructionId_fkey" FOREIGN KEY ("constructionSideId", "constructionId") REFERENCES "ConstructionSide"("id", "constructionId") ON DELETE RESTRICT ON UPDATE CASCADE;
