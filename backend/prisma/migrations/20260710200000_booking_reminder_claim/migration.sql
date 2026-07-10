-- Short-lived claim before Telegram delivery. A stale claim is reclaimed by the
-- sender, so a process crash cannot suppress a reminder permanently.
ALTER TABLE "Booking" ADD COLUMN "reminderSendingToken" TEXT;
ALTER TABLE "Booking" ADD COLUMN "reminderSendingAt" TIMESTAMP(3);

CREATE INDEX "Booking_reminderSendingAt_idx" ON "Booking"("reminderSendingAt");
