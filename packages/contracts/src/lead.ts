import { z } from "zod";
import { stageKindSchema } from "./stage";
import { WEB_SOURCE_IDS } from "./source";
import { dealBookingSummarySchema, dealDocumentSchema } from "./deal";

/**
 * Источник заявки — id строки управляемого справочника (`source.ts`).
 * Id системных строк — прежние слаги enum'а; существование/архивность
 * проверяет сервис (как у этапов и типов контакта).
 */
export const leadSourceSchema = z.string().trim().min(1).max(64);
export type LeadSource = z.infer<typeof leadSourceSchema>;

/**
 * Приводит телефон к каноническому `+7XXXXXXXXXX`, если это валидный РФ-номер
 * (11 цифр с кодом `+7`/`8`), иначе — `null`. Единый ключ дедупликации: и приём
 * заявки, и ручной ввод контакта используют один формат, чтобы клиент из заявки
 * и заведённый вручную склеивались по телефону. Требование ведущей `7`/`8`
 * бережёт зарубежные 11-значные номера (напр. US `+1…`) от ложной РФ-нормализации.
 */
export function normalizeRuPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 || (digits[0] !== "7" && digits[0] !== "8")) return null;
  return `+7${digits.slice(1)}`;
}

/**
 * Российский номер телефона. Принимаем маску с лендинга
 * (`+7 (928) 000-93-00`) и нормализуем к `+7XXXXXXXXXX`.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => normalizeRuPhone(value))
  .refine((value): value is string => value !== null, {
    message: "Введите номер телефона полностью",
  });

/**
 * Телефон CRM-контакта. Для российских номеров используем тот же канон, что и
 * заявки (`+7XXXXXXXXXX`), но партнёры могут хранить международный номер.
 */
export const crmContactPhoneSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, ctx) => {
    const normalized = normalizeRuPhone(value);
    if (normalized) return normalized;

    const digits = value.replace(/\D/g, "");
    const looksRussianDraft = value.startsWith("+7") || digits.startsWith("7") || digits.startsWith("8");
    const looksPhoneLike = /^[+\d\s().-]+$/.test(value) && digits.length >= 6;
    if (!looksRussianDraft && looksPhoneLike) return value;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Введите номер телефона полностью",
    });
    return z.NEVER;
  });

/**
 * Тело запроса на создание заявки (то, что шлёт лид-форма).
 *
 * `company` — honeypot: реального поля в дизайне нет, оно скрыто и пусто для
 * человека; боты заполняют его автоматически. Заполненный honeypot сервис
 * молча отклоняет (отдаёт «успех»), поэтому здесь поле просто опционально и
 * не валидируется как ошибка.
 */
export const createLeadSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(120),
  phone: phoneSchema,
  consent: z.literal(true, {
    errorMap: () => ({ message: "Необходимо согласие на обработку данных" }),
  }),
  // Публичная форма шлёт только фиксированные веб-слаги — произвольный источник
  // с улицы не принимаем (кастомные источники назначаются внутри CRM).
  source: z.enum(WEB_SOURCE_IDS).default("hero_form"),
  constructionId: z.string().trim().max(64).optional(),
  message: z.string().trim().max(2000).optional(),
  company: z.string().max(200).optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/**
 * Ручной приём заявки в CRM (оффлайн: пришёл в офис / привёл партнёр). В отличие
 * от публичной формы: без honeypot/анти-спама, с опциональным реферером-партнёром
 * и ответственным (адресно на другого менеджера — только admin, проверяет сервис).
 * Согласие ПДн подтверждает оператор (`consent: true`); клиент-контакт заводится/
 * дедупится по телефону тем же путём, что и при веб-приёме. Источник по умолчанию
 * `offline`, но оператор может уточнить канал.
 */
const manualLeadNewReferrerSchema = z.object({
  fullName: z.string().trim().min(2, "Укажите имя партнёра").max(160),
  phone: crmContactPhoneSchema.nullable().optional(),
});

export const createManualLeadSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(120),
  phone: phoneSchema,
  // boolean + refine (а не literal(true)): чекбокс формы шлёт реальный стейт, а
  // валидация «требуется true» остаётся единственным источником истины.
  consent: z.boolean().refine((v) => v === true, {
    message: "Подтвердите согласие клиента на обработку данных",
  }),
  // Ручной приём — только не-веб источники (оффлайн/прочее/кастомные из
  // справочника); веб-слаги проставляет лендинг автоматически. Живость и
  // не-веб проверяет сервис.
  source: leadSourceSchema.default("offline"),
  constructionId: z.string().trim().max(64).optional(),
  message: z.string().trim().max(2000).optional(),
  contactId: z.string().min(1).optional(),
  /**
   * Воронка приёма: заявка падает в её входной этап. Не задана — воронка по
   * умолчанию (как у публичных заявок с лендинга).
   */
  funnelId: z.string().min(1).optional(),
  /** Партнёр, приведший заявку; необязателен. */
  referrerId: z.string().min(1).optional(),
  /** Новый партнёр, которого нужно создать атомарно вместе с оффлайн-заявкой. */
  newReferrer: manualLeadNewReferrerSchema.optional(),
  /** Ответственный менеджер; не задан — общая очередь/авто по повторной. */
  assigneeId: z.string().min(1).optional(),
}).refine((v) => !(v.referrerId && v.newReferrer), {
  path: ["newReferrer"],
  message: "Выберите существующего реферера или создайте нового, не оба варианта сразу",
});
export type CreateManualLeadInput = z.infer<typeof createManualLeadSchema>;

/** Краткая ссылка на этап воронки внутри DTO заявки (без догрузки справочника). */
export const leadStageRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: stageKindSchema,
  /** Воронка этапа — чтобы карточка показывала этапы только этой воронки. */
  funnelId: z.string(),
});
export type LeadStageRef = z.infer<typeof leadStageRefSchema>;

/** DTO заявки для списка CRM. */
export const leadSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  source: leadSourceSchema,
  /** Название источника (развёрнуто из справочника) — для показа. */
  sourceName: z.string().nullable(),
  /** Текущий этап воронки (FK на `Stage`). Заменил прежний enum-статус. */
  stageId: z.string(),
  /** Развёрнутый этап для отображения и признака активна/закрыта (по `kind`). */
  stage: leadStageRefSchema,
  constructionId: z.string().nullable(),
  /** Название конструкции (развёрнуто из `constructionId`) — для показа без догрузки справочника. */
  constructionName: z.string().nullable(),
  message: z.string().nullable(),
  /** Контрагент с ролью клиента; ставится при приёме заявки. */
  contactId: z.string().nullable(),
  /** Имя контакта-покупателя для ссылки из карточки сделки. */
  contactName: z.string().nullable(),
  /** Партнёр, который привёл заявку. */
  referrerId: z.string().nullable(),
  /** Ответственный менеджер; `null` — заявка в общей очереди. */
  assigneeId: z.string().nullable(),
  /** Заявка с телефона, по которому уже была заявка за последние 30 дней. */
  isRepeat: z.boolean(),
  /** Дата следующего контакта; снимается при закрытии заявки (won/lost). */
  nextContactAt: z.string().nullable(),
  /** Тип следующего контакта (id из справочника ContactType); `null` — не задан. */
  nextContactTypeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Lead = z.infer<typeof leadSchema>;

/** Заметка менеджера в карточке заявки. */
export const leadNoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  authorId: z.string(),
  authorEmail: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LeadNote = z.infer<typeof leadNoteSchema>;

/** Событие истории смены этапа заявки (этап, автор, время). */
export const leadStatusEventSchema = z.object({
  id: z.string(),
  stage: leadStageRefSchema,
  /** Автор перехода; `null` — системное событие (создание/перенос). */
  authorId: z.string().nullable(),
  authorEmail: z.string().nullable(),
  createdAt: z.string(),
});
export type LeadStatusEvent = z.infer<typeof leadStatusEventSchema>;

/**
 * Событие истории назначений: кто стал ответственным (`assigneeId = null` —
 * возврат в общую очередь), кем назначен (`authorId = null` — система:
 * авто-назначение повторной заявки прошлому менеджеру).
 */
export const leadAssignEventSchema = z.object({
  id: z.string(),
  assigneeId: z.string().nullable(),
  /** Подпись нового ответственного (имя/почта); null — «в общую очередь». */
  assigneeLabel: z.string().nullable(),
  authorId: z.string().nullable(),
  authorEmail: z.string().nullable(),
  createdAt: z.string(),
});
export type LeadAssignEvent = z.infer<typeof leadAssignEventSchema>;

/**
 * Событие истории задач «следующий контакт»: назначение/перенос (`at` +
 * снимок имени типа) либо снятие напоминания (`at = null`). Имя типа —
 * снимок на момент события: архивация справочника не ломает историю.
 */
export const leadContactEventKindSchema = z.enum([
  "scheduled", // контакт назначен/перенесён
  "cleared", // напоминание снято (вручную или закрытием сделки)
  "done", // контакт состоялся
  "cancelled", // контакт отменён
  "missed", // старые события недозвона; в UI показываются как отменённые
]);
export type LeadContactEventKind = z.infer<typeof leadContactEventKindSchema>;

export const leadContactEventSchema = z.object({
  id: z.string(),
  kind: leadContactEventKindSchema,
  /** Дата контакта события; для `cleared` — null. */
  at: z.string().nullable(),
  /** Название типа контакта на момент события; null — без типа. */
  typeName: z.string().nullable(),
  authorId: z.string().nullable(),
  authorEmail: z.string().nullable(),
  createdAt: z.string(),
});
export type LeadContactEvent = z.infer<typeof leadContactEventSchema>;

/** Краткая ссылка на реферера-партнёра для показа в карточке заявки. */
export const leadReferrerRefSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  type: z.enum(["individual", "company"]),
});
export type LeadReferrerRef = z.infer<typeof leadReferrerRefSchema>;

/**
 * Полная карточка заявки: данные + заметки + история статусов + связанные
 * заявки по тому же телефону (для повторных). Связанные отдаются read-only.
 */
export const leadDetailSchema = leadSchema.extend({
  notes: z.array(leadNoteSchema),
  statusHistory: z.array(leadStatusEventSchema),
  /** История назначений ответственного (для ленты активности). */
  assignHistory: z.array(leadAssignEventSchema),
  /** История задач «следующий контакт» (для ленты активности). */
  contactHistory: z.array(leadContactEventSchema),
  related: z.array(leadSchema),
  /** Развёрнутый реферер (если задан) — для показа/выбора в карточке. */
  referrer: leadReferrerRefSchema.nullable(),
  /** Брони сделки (привязанные к заявке через `leadId`), read-only. */
  bookings: z.array(dealBookingSummarySchema),
  /** Прикреплённые закрывающие документы сделки. */
  dealDocuments: z.array(dealDocumentSchema),
  /** Отметка «по сделке документов нет» (мелкая сделка без бумаг). */
  dealNoDocuments: z.boolean(),
});
export type LeadDetail = z.infer<typeof leadDetailSchema>;

/**
 * Перевод заявки на другой этап из CRM. Целевой — любой живой этап: переходы
 * свободны и МОГУТ пересекать воронки. Кросс-воронковый перевод — штатный способ
 * освободить воронку перед архивацией (`archiveFunnel` блокирует архив, пока в
 * воронке есть заявки, — «сначала переместите их»). Целостность держит FK на
 * Stage; UI по умолчанию показывает этапы только своей воронки.
 */
export const updateLeadStageSchema = z.object({
  stageId: z.string(),
});
export type UpdateLeadStageInput = z.infer<typeof updateLeadStageSchema>;

/**
 * Назначение ответственного. `assigneeId = null` — вернуть в общую очередь.
 * Право адресно назначить на другого менеджера — только у admin (проверяет
 * сервис); менеджер может взять заявку себе или вернуть в очередь.
 */
export const assignLeadSchema = z.object({
  assigneeId: z.string().nullable(),
});
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;

/** Дата следующего контакта; `null` — снять напоминание. С типом контакта. */
export const updateNextContactSchema = z.object({
  nextContactAt: z.string().datetime().nullable(),
  /** Тип контакта из справочника; `null` — без типа. Необязателен. */
  nextContactTypeId: z.string().nullable().optional(),
});
export type UpdateNextContactInput = z.infer<typeof updateNextContactSchema>;

/**
 * Итог назначенного контакта: состоялся / отменён. Пишет событие в
 * историю задач и снимает напоминание (следующее менеджер ставит сам).
 */
export const completeNextContactSchema = z.object({
  outcome: z.enum(["done", "cancelled"]),
});
export type CompleteNextContactInput = z.infer<typeof completeNextContactSchema>;

/** Смена источника заявки вручную из CRM (исправление/уточнение канала). */
export const updateLeadSourceSchema = z.object({
  source: leadSourceSchema,
});
export type UpdateLeadSourceInput = z.infer<typeof updateLeadSourceSchema>;

/** Смена/снятие конструкции в карточке сделки. */
export const updateLeadConstructionSchema = z.object({
  constructionId: z.string().min(1).nullable(),
});
export type UpdateLeadConstructionInput = z.infer<
  typeof updateLeadConstructionSchema
>;

/**
 * Назначить/снять реферера заявки (контрагент с ролью партнёра).
 * `referrerId = null` — снять привязку.
 */
export const setLeadReferrerSchema = z.object({
  referrerId: z.string().min(1).nullable(),
});
export type SetLeadReferrerInput = z.infer<typeof setLeadReferrerSchema>;

/** Создание заметки в карточке заявки. */
export const createNoteSchema = z.object({
  text: z.string().trim().min(1, "Пустая заметка").max(2000),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

/** Редактирование заметки (автор — свою, admin — любую). */
export const updateNoteSchema = createNoteSchema;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

/**
 * Параметры списка заявок CRM: фильтры, поиск и пагинация. Видимость
 * (свои + неназначенные для менеджера, все — для admin) накладывается в
 * сервисе поверх этих фильтров. По умолчанию 25 заявок на страницу.
 */
export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // До 500 — чтобы канбан-доска могла поднять заявки сразу по всем этапам одним
  // запросом (список CRM использует обычные 25/стр).
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  stageId: z.string().optional(),
  /** Фильтр по воронке (через этап заявки). */
  funnelId: z.string().optional(),
  source: leadSourceSchema.optional(),
  constructionId: z.string().optional(),
  /** Ответственный; литерал `"none"` — только не назначенные (общая очередь). */
  assigneeId: z.string().optional(),
  /** Фильтр по рефереру (партнёру), приведшему заявку. */
  referrerId: z.string().optional(),
  /** Период по дате создания (ISO-8601), включительно. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Текстовый поиск по имени и телефону. */
  search: z.string().trim().max(120).optional(),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

/**
 * Параметры «Моего дня». `scope` учитывается только для admin (у менеджера
 * повестка всегда своя): `all` (по умолчанию для admin) — заявки всей команды,
 * `mine` — только свои.
 */
export const leadAgendaQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).optional(),
});
export type LeadAgendaQuery = z.infer<typeof leadAgendaQuerySchema>;

/** Строка повестки: активная заявка (дата контакта есть у всех групп, кроме «без задачи»). */
export const leadAgendaItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  /** Название текущего этапа (все — живые, `kind=in_progress`). */
  stageName: z.string(),
  /** `null` только в группе `noTask` (дата следующего контакта не назначена). */
  nextContactAt: z.string().nullable(),
  /** Тип следующего контакта (название из справочника); `null` — не задан. */
  nextContactTypeName: z.string().nullable(),
});
export type LeadAgendaItem = z.infer<typeof leadAgendaItemSchema>;

/**
 * «Мой день»: активные заявки, разложенные по дню МСК на просроченные,
 * сегодняшние и ближайшие (следующие 7 дней) — по возрастанию `nextContactAt`.
 * `noTask` — активные заявки БЕЗ даты следующего контакта: без этой группы
 * такая заявка не попадает ни в одну повестку и молча теряется (старые сверху).
 */
export const leadAgendaResponseSchema = z.object({
  overdue: z.array(leadAgendaItemSchema),
  today: z.array(leadAgendaItemSchema),
  upcoming: z.array(leadAgendaItemSchema),
  noTask: z.array(leadAgendaItemSchema),
});
export type LeadAgendaResponse = z.infer<typeof leadAgendaResponseSchema>;
