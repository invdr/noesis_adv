-- CreateEnum
CREATE TYPE "FinanceParticipantKind" AS ENUM ('owner', 'investor', 'other');

-- CreateEnum
CREATE TYPE "FinanceExpenseStatus" AS ENUM ('draft', 'confirmed');

-- CreateEnum
CREATE TYPE "FinanceDistributionStatus" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "FinanceExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceParticipant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinanceParticipantKind" NOT NULL DEFAULT 'other',
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceShare" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "startMonth" TIMESTAMP(3) NOT NULL,
    "endMonth" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceIncome" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "constructionId" TEXT,
    "bookingId" TEXT,
    "comment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceExpense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "FinanceExpenseStatus" NOT NULL DEFAULT 'draft',
    "categoryId" TEXT NOT NULL,
    "constructionId" TEXT,
    "constructionSideId" TEXT,
    "bookingId" TEXT,
    "comment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceDistribution" (
    "id" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "status" "FinanceDistributionStatus" NOT NULL DEFAULT 'open',
    "totalIncome" INTEGER NOT NULL DEFAULT 0,
    "totalExpense" INTEGER NOT NULL DEFAULT 0,
    "netIncome" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAllocation" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "participantName" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePayout" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "month" TIMESTAMP(3),
    "comment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancePayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceExpenseCategory_archivedAt_idx" ON "FinanceExpenseCategory"("archivedAt");

-- CreateIndex
CREATE INDEX "FinanceExpenseCategory_order_idx" ON "FinanceExpenseCategory"("order");

-- CreateIndex
CREATE INDEX "FinanceParticipant_archivedAt_idx" ON "FinanceParticipant"("archivedAt");

-- CreateIndex
CREATE INDEX "FinanceShare_participantId_idx" ON "FinanceShare"("participantId");

-- CreateIndex
CREATE INDEX "FinanceIncome_date_idx" ON "FinanceIncome"("date");

-- CreateIndex
CREATE INDEX "FinanceIncome_constructionId_idx" ON "FinanceIncome"("constructionId");

-- CreateIndex
CREATE INDEX "FinanceIncome_bookingId_idx" ON "FinanceIncome"("bookingId");

-- CreateIndex
CREATE INDEX "FinanceExpense_date_idx" ON "FinanceExpense"("date");

-- CreateIndex
CREATE INDEX "FinanceExpense_status_idx" ON "FinanceExpense"("status");

-- CreateIndex
CREATE INDEX "FinanceExpense_categoryId_idx" ON "FinanceExpense"("categoryId");

-- CreateIndex
CREATE INDEX "FinanceExpense_constructionId_idx" ON "FinanceExpense"("constructionId");

-- CreateIndex
CREATE INDEX "FinanceExpense_constructionSideId_idx" ON "FinanceExpense"("constructionSideId");

-- CreateIndex
CREATE INDEX "FinanceExpense_bookingId_idx" ON "FinanceExpense"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDistribution_periodMonth_key" ON "FinanceDistribution"("periodMonth");

-- CreateIndex
CREATE INDEX "FinanceDistribution_status_idx" ON "FinanceDistribution"("status");

-- CreateIndex
CREATE INDEX "FinanceAllocation_distributionId_idx" ON "FinanceAllocation"("distributionId");

-- CreateIndex
CREATE INDEX "FinanceAllocation_participantId_idx" ON "FinanceAllocation"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAllocation_distributionId_participantId_key" ON "FinanceAllocation"("distributionId", "participantId");

-- CreateIndex
CREATE INDEX "FinancePayout_participantId_idx" ON "FinancePayout"("participantId");

-- CreateIndex
CREATE INDEX "FinancePayout_date_idx" ON "FinancePayout"("date");

-- CreateIndex
CREATE INDEX "FinancePayout_month_idx" ON "FinancePayout"("month");

-- AddForeignKey
ALTER TABLE "FinanceShare" ADD CONSTRAINT "FinanceShare_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "FinanceParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceIncome" ADD CONSTRAINT "FinanceIncome_constructionId_fkey" FOREIGN KEY ("constructionId") REFERENCES "Construction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceIncome" ADD CONSTRAINT "FinanceIncome_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceIncome" ADD CONSTRAINT "FinanceIncome_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_constructionId_fkey" FOREIGN KEY ("constructionId") REFERENCES "Construction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_constructionSideId_fkey" FOREIGN KEY ("constructionSideId") REFERENCES "ConstructionSide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceExpense" ADD CONSTRAINT "FinanceExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDistribution" ADD CONSTRAINT "FinanceDistribution_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAllocation" ADD CONSTRAINT "FinanceAllocation_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "FinanceDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAllocation" ADD CONSTRAINT "FinanceAllocation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "FinanceParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePayout" ADD CONSTRAINT "FinancePayout_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "FinanceParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePayout" ADD CONSTRAINT "FinancePayout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

