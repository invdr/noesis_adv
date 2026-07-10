-- Дедуп Telegram-дайджеста напоминаний о сроке брони.
ALTER TABLE "Booking" ADD COLUMN "reminderNotifiedAt" TIMESTAMP(3);

-- Бэкфилл: помечаем «уже уведомлёнными» напоминания, наступившие до этой
-- миграции, и напоминания у неактивных броней (отменённые/завершённые) — чтобы
-- первый запуск cron-рассылки не отправил задним числом пачку исторических
-- напоминаний. Будущие активные напоминания остаются null и отработают в срок.
UPDATE "Booking"
SET "reminderNotifiedAt" = CURRENT_TIMESTAMP
WHERE "reminderAt" IS NOT NULL
  AND ("reminderAt" <= CURRENT_TIMESTAMP OR "status" IN ('cancelled', 'completed'));
