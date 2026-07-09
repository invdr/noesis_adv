// Сид: первый администратор (ADMIN_EMAIL/ADMIN_PASSWORD) и дефолтная воронка
// статусов. Запуск: `bun run --cwd backend db:seed`. Идемпотентно — повторный
// запуск ничего не дублирует. Учётные данные в репо не коммитятся; пароль
// помечается на смену при первом входе.
import type { Prisma } from "@prisma/client";
import { createRuntime } from "../src/runtime";
import type { Runtime } from "../src/runtime";
import { createUser } from "../src/auth/auth-service";
import { seedContent } from "./seed-content";

/**
 * Дефолтная воронка. Id стабильны и совпадают с data-миграцией стартовой
 * воронки — поэтому на свежемигрированной БД сид этапов просто пропускается.
 */
/** Id дефолтной воронки — совпадает с data-миграцией воронок. */
const DEFAULT_FUNNEL_ID = "funnel_default";

const DEFAULT_STAGES: Prisma.StageCreateManyInput[] = [
  { id: "stage_new", name: "Новая", order: 1, kind: "in_progress", isEntry: true, color: "blue", funnelId: DEFAULT_FUNNEL_ID },
  { id: "stage_in_progress", name: "В работе", order: 2, kind: "in_progress", color: "slate", funnelId: DEFAULT_FUNNEL_ID },
  { id: "stage_nedozvon", name: "Недозвон", order: 3, kind: "in_progress", color: "amber", funnelId: DEFAULT_FUNNEL_ID },
  { id: "stage_meeting", name: "Встреча/показ", order: 4, kind: "in_progress", color: "violet", funnelId: DEFAULT_FUNNEL_ID },
  { id: "stage_booking", name: "Бронь", order: 5, kind: "in_progress", color: "teal", funnelId: DEFAULT_FUNNEL_ID },
  { id: "stage_deal", name: "Сделка", order: 6, kind: "won", color: "green", funnelId: DEFAULT_FUNNEL_ID },
  { id: "stage_reject", name: "Отказ", order: 7, kind: "lost", color: "red", funnelId: DEFAULT_FUNNEL_ID },
];

async function seedStages(rt: Runtime): Promise<void> {
  // Дефолтная воронка (идемпотентно): на ней висят все стартовые этапы.
  await rt.prisma.funnel.upsert({
    where: { id: DEFAULT_FUNNEL_ID },
    update: {},
    create: { id: DEFAULT_FUNNEL_ID, name: "Клиенты", order: 1, isDefault: true },
  });

  const existing = await rt.prisma.stage.count();
  if (existing > 0) {
    console.log(`Этапы воронки уже есть (${existing}) — пропускаем сидинг воронки.`);
    return;
  }
  const { count } = await rt.prisma.stage.createMany({ data: DEFAULT_STAGES });
  console.log(`Создана дефолтная воронка (${count} этапов).`);
}

/**
 * Системные источники заявок (id-слаги зашиты в формы лендинга и дефолты
 * ручного приёма). На существующих БД их создаёт миграция; сид — для свежих.
 */
const SYSTEM_LEAD_SOURCES = [
  { id: "hero_form", name: "Главная форма", order: 1, isSystem: true, isWeb: true },
  { id: "project", name: "Карточка конструкции", order: 2, isSystem: true, isWeb: true },
  { id: "contacts", name: "Контакты", order: 3, isSystem: true, isWeb: true },
  { id: "offline", name: "Оффлайн", order: 4, isSystem: true, isWeb: false },
  { id: "other", name: "Прочее", order: 5, isSystem: true, isWeb: false },
];

async function seedLeadSources(rt: Runtime): Promise<void> {
  for (const src of SYSTEM_LEAD_SOURCES) {
    await rt.prisma.leadSource.upsert({
      where: { id: src.id },
      update: {},
      create: src,
    });
  }
}

/** Стартовые типы следующего контакта (стабильные id — для идемпотентности). */
const DEFAULT_CONTACT_TYPES = [
  { id: "contacttype_call", name: "Звонок", order: 1 },
  { id: "contacttype_message", name: "Сообщение", order: 2 },
  { id: "contacttype_meeting", name: "Встреча", order: 3 },
];

async function seedContactTypes(rt: Runtime): Promise<void> {
  for (const ct of DEFAULT_CONTACT_TYPES) {
    await rt.prisma.contactType.upsert({
      where: { id: ct.id },
      update: {},
      create: ct,
    });
  }
}

/** Стартовые причины служебных броней. */
const DEFAULT_BOOKING_SERVICE_REASONS = [
  { id: "booking_reason_repair", name: "Ремонт", order: 1 },
  { id: "booking_reason_own_ad", name: "Своя реклама", order: 2 },
  { id: "booking_reason_reserve", name: "Резерв", order: 3 },
  { id: "booking_reason_dismantling", name: "Демонтаж", order: 4 },
];

async function seedBookingServiceReasons(rt: Runtime): Promise<void> {
  for (const reason of DEFAULT_BOOKING_SERVICE_REASONS) {
    await rt.prisma.bookingServiceReason.upsert({
      where: { id: reason.id },
      update: {},
      create: reason,
    });
  }
}

async function seedAdmin(rt: Runtime): Promise<void> {
  if (!rt.env.ADMIN_EMAIL || !rt.env.ADMIN_PASSWORD) {
    throw new Error(
      "Задайте ADMIN_EMAIL и ADMIN_PASSWORD в backend/.env для сидинга администратора",
    );
  }
  const email = rt.env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = await rt.prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Администратор ${email} уже существует — пропускаем.`);
    return;
  }
  await createUser(rt, {
    email,
    name: "Администратор",
    password: rt.env.ADMIN_PASSWORD,
    role: "admin",
    mustChangePassword: true,
  });
  console.log(`Создан администратор ${email} (потребуется сменить пароль при входе).`);
}

async function main(): Promise<void> {
  const rt = createRuntime();
  try {
    await seedStages(rt);
    await seedLeadSources(rt);
    await seedContactTypes(rt);
    await seedBookingServiceReasons(rt);
    await seedAdmin(rt);
    await seedContent(rt);
  } finally {
    await rt.prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Сидинг администратора не удался:", error);
  process.exit(1);
});
