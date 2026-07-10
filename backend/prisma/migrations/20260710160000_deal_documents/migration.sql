-- Закрывающие документы сделки (Этап 4): тип, таблица, флаг «без документов».
CREATE TYPE "DealDocumentType" AS ENUM ('contract', 'invoice', 'act', 'other');

ALTER TABLE "Lead" ADD COLUMN "dealNoDocuments" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DealDocument" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "DealDocumentType" NOT NULL DEFAULT 'other',
    "name" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealDocument_leadId_idx" ON "DealDocument"("leadId");

ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
