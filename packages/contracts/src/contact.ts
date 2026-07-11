import { z } from "zod";
import { crmContactPhoneSchema, leadSourceSchema, leadStageRefSchema } from "./lead";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalDateText = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату в формате ГГГГ-ММ-ДД")
  .nullable()
  .optional();

/**
 * Контакт CRM — единая сущность вместо прежнего эфемерного «клиента» (агрегата
 * заявок по телефону). У контакта есть тип:
 * Вид (человек или компания) и роли независимы: одна карточка может быть
 * одновременно клиентом и партнёром. Человек-партнёр может представлять
 * компанию через `organizationId`.
 */

/** Тип контакта. */
export const counterpartyTypeSchema = z.enum(["individual", "company"]);
export type CounterpartyType = z.infer<typeof counterpartyTypeSchema>;

/** Подписи типов для UI. */
export const COUNTERPARTY_TYPE_LABEL: Record<CounterpartyType, string> = {
  individual: "Человек",
  company: "Компания",
};

export const counterpartyRoleSchema = z.enum(["client", "partner"]);
export type CounterpartyRole = z.infer<typeof counterpartyRoleSchema>;

/**
 * DTO контакта для списка/карточки. Счётчики и агрегаты заявок считает сервис:
 * `leadsCount`/`lastLeadAt`/`lastStage` — как у покупателя (по `contactId`),
 * `referredCount` — как у реферера (по `referrerId`).
 */
export const contactSchema = z.object({
  id: z.string(),
  type: counterpartyTypeSchema,
  isClient: z.boolean(),
  isPartner: z.boolean(),
  fullName: z.string(),
  /** Нормализованный телефон; у клиента служит ключом дедупликации. */
  phone: z.string().nullable(),
  /** Компания, которую представляет человек-партнёр. */
  organizationId: z.string().nullable(),
  /** Название компании для показа, если `organizationId` задан. */
  organizationName: z.string().nullable(),
  /** Пользователь, вручную заведший контакт; null у контактов из авто-приёма или старых записей. */
  createdById: z.string().nullable(),
  note: z.string().nullable(),
  /** Паспортные данные клиента для будущего мастера сделок. Для партнёров null. */
  birthDate: z.string().nullable(),
  birthPlace: z.string().nullable(),
  passportSeries: z.string().nullable(),
  passportNumber: z.string().nullable(),
  passportIssuedBy: z.string().nullable(),
  passportIssuedAt: z.string().nullable(),
  passportDepartmentCode: z.string().nullable(),
  registrationAddress: z.string().nullable(),
  actualAddress: z.string().nullable(),
  legalName: z.string().nullable(),
  inn: z.string().nullable(),
  kpp: z.string().nullable(),
  ogrn: z.string().nullable(),
  legalAddress: z.string().nullable(),
  postalAddress: z.string().nullable(),
  bankName: z.string().nullable(),
  bankBik: z.string().nullable(),
  bankAccount: z.string().nullable(),
  correspondentAccount: z.string().nullable(),
  directorTitle: z.string().nullable(),
  directorFullName: z.string().nullable(),
  directorBasis: z.string().nullable(),
  /** Ручное переопределение «последнего взаимодействия»; иначе считается по заявкам. */
  lastInteractionAt: z.string().nullable(),
  /** Сколько заявок, где контакт — покупатель (видимых пользователю). */
  leadsCount: z.number().int(),
  /** Сколько заявок приведено этим контактом (для партнёров). */
  referredCount: z.number().int(),
  /** Id самой свежей видимой заявки-покупателя (для перехода в карточку) или null. */
  lastLeadId: z.string().nullable(),
  /** Дата самой свежей заявки-покупателя (ISO) или null. */
  lastLeadAt: z.string().nullable(),
  /** Этап самой свежей заявки-покупателя (для клиентов) или null. */
  lastStage: leadStageRefSchema.nullable(),
  /** Источник самой свежей заявки-покупателя (id справочника) или null. */
  lastSource: leadSourceSchema.nullable(),
  /** Название источника самой свежей заявки или null. */
  lastSourceName: z.string().nullable(),
  /** Ответственный по самой свежей заявке-покупателя; null — общая очередь. */
  assigneeId: z.string().nullable(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contact = z.infer<typeof contactSchema>;

/** Краткая строка заявки в карточке контакта (свои и приведённые). */
export const contactLeadRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  stage: leadStageRefSchema,
  source: leadSourceSchema,
  sourceName: z.string().nullable(),
  projectName: z.string().nullable(),
  assigneeId: z.string().nullable(),
});
export type ContactLeadRef = z.infer<typeof contactLeadRefSchema>;

/**
 * Полная карточка контакта: данные + заявки. `leads` — заявки, где контакт
 * покупатель (для клиентов); `referredLeads` — приведённые (для партнёров).
 * Оба списка отфильтрованы видимостью пользователя.
 */
export const contactDetailSchema = contactSchema.extend({
  leads: z.array(contactLeadRefSchema),
  referredLeads: z.array(contactLeadRefSchema),
});
export type ContactDetail = z.infer<typeof contactDetailSchema>;

/**
 * Создание/обновление контакта. Оптимистичная блокировка по версии
 * (`expectedUpdatedAt` → 409), как у конструкций/новостей/настроек. Инварианты
 * (компанию можно выбрать только у партнёра-человека, без самоссылки) — в сервисе.
 */
export const upsertContactSchema = z.object({
  type: counterpartyTypeSchema,
  isClient: z.boolean(),
  isPartner: z.boolean(),
  fullName: z.string().trim().min(1, "Укажите имя").max(160),
  // РФ-телефон нормализуем тем же ключом, что и заявки; международные номера
  // партнёров сохраняем как есть. Строгость для клиентов проверяет сервис.
  phone: crmContactPhoneSchema.nullable().optional(),
  organizationId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  birthDate: optionalDateText,
  birthPlace: optionalText(200),
  passportSeries: optionalText(12),
  passportNumber: optionalText(16),
  passportIssuedBy: optionalText(300),
  passportIssuedAt: optionalDateText,
  passportDepartmentCode: optionalText(16),
  registrationAddress: optionalText(300),
  actualAddress: optionalText(300),
  legalName: optionalText(240),
  inn: optionalText(12),
  kpp: optionalText(9),
  ogrn: optionalText(15),
  legalAddress: optionalText(300),
  postalAddress: optionalText(300),
  bankName: optionalText(200),
  bankBik: optionalText(9),
  bankAccount: optionalText(32),
  correspondentAccount: optionalText(32),
  directorTitle: optionalText(120),
  directorFullName: optionalText(160),
  directorBasis: optionalText(160),
  /** Ручная дата последнего взаимодействия (ISO); null — снять переопределение. */
  lastInteractionAt: z.string().datetime().nullable().optional(),
  expectedUpdatedAt: z.string().optional(),
}).superRefine((value, ctx) => {
  if (!value.isClient && !value.isPartner) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["isClient"],
      message: "Выберите роль клиента или партнёра",
    });
  }
  if (value.type === "company" && value.organizationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["organizationId"],
      message: "Компания не может входить в другую компанию",
    });
  }
});
export type UpsertContactInput = z.infer<typeof upsertContactSchema>;

/** Параметры списка контактов: фильтр по типу, поиск, архивные (admin). */
export const listContactsQuerySchema = z.object({
  type: counterpartyTypeSchema.optional(),
  role: counterpartyRoleSchema.optional(),
  search: z.string().trim().max(120).optional(),
  includeArchived: z.boolean().optional(),
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;
