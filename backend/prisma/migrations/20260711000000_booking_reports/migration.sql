CREATE TABLE "BookingReport" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BookingReportPhoto" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingReportPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingReport_bookingId_year_month_key" ON "BookingReport"("bookingId", "year", "month");
CREATE INDEX "BookingReport_bookingId_idx" ON "BookingReport"("bookingId");
CREATE UNIQUE INDEX "BookingReportPhoto_reportId_assetId_key" ON "BookingReportPhoto"("reportId", "assetId");
CREATE INDEX "BookingReportPhoto_reportId_idx" ON "BookingReportPhoto"("reportId");

ALTER TABLE "BookingReport" ADD CONSTRAINT "BookingReport_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingReport" ADD CONSTRAINT "BookingReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingReportPhoto" ADD CONSTRAINT "BookingReportPhoto_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "BookingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingReportPhoto" ADD CONSTRAINT "BookingReportPhoto_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
