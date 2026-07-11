-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('individual', 'company');

-- Add the replacement fields first. Existing CRM records are then copied below
-- before the legacy discriminator and agency columns are removed.
ALTER TABLE "Contact"
ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "bankBik" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "correspondentAccount" TEXT,
ADD COLUMN     "directorBasis" TEXT,
ADD COLUMN     "directorFullName" TEXT,
ADD COLUMN     "directorTitle" TEXT,
ADD COLUMN     "inn" TEXT,
ADD COLUMN     "isClient" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isPartner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kpp" TEXT,
ADD COLUMN     "legalAddress" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "ogrn" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "postalAddress" TEXT,
ADD COLUMN     "type" "CounterpartyType" NOT NULL DEFAULT 'individual';

-- Preserve all historical links and semantics:
-- client -> individual/client; realtor -> individual/partner; agency -> company/partner.
-- The former agency relation becomes the representative's organization, and
-- the old legal company name is retained as the new legal name.
UPDATE "Contact"
SET
  "type" = CASE WHEN "kind" = 'agency' THEN 'company'::"CounterpartyType" ELSE 'individual'::"CounterpartyType" END,
  "isClient" = ("kind" = 'client'),
  "isPartner" = ("kind" IN ('realtor', 'agency')),
  "organizationId" = "agencyId",
  "legalName" = CASE WHEN "kind" = 'agency' THEN "companyName" ELSE NULL END;

-- Old relationships and fields are safe to remove only after the backfill.
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_agencyId_fkey";
DROP INDEX "Contact_agencyId_idx";
DROP INDEX "Contact_kind_idx";
ALTER TABLE "Contact"
DROP COLUMN "agencyId",
DROP COLUMN "companyName",
DROP COLUMN "kind";

-- DropEnum
DROP TYPE "ContactKind";

-- CreateIndex
CREATE INDEX "Contact_type_idx" ON "Contact"("type");

-- CreateIndex
CREATE INDEX "Contact_isClient_idx" ON "Contact"("isClient");

-- CreateIndex
CREATE INDEX "Contact_isPartner_idx" ON "Contact"("isPartner");

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
