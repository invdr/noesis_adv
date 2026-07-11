import type {
  AssignLeadInput,
  CompleteNextContactInput,
  CreateLeadInput,
  CreateManualLeadInput,
  CreateNoteInput,
  Lead,
  LeadAgendaItem,
  LeadAgendaQuery,
  LeadAgendaResponse,
  LeadDetail,
  LeadNote,
  ListLeadsQuery,
  SessionUser,
  SetLeadReferrerInput,
  UpdateLeadConstructionInput,
  UpdateLeadSourceInput,
  UpdateLeadStageInput,
  UpdateNextContactInput,
  UpdateNoteInput,
} from "@noesis/contracts";
import type { Lead as PrismaLead, Prisma } from "@prisma/client";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { mskDay } from "../http/msk";
import { getEntryStageId } from "../stages/stage-service";
import { requireAssignableSource } from "../sources/source-service";
import { findOrCreateClientByPhone } from "../contacts/contact-service";
import { canAccessClientContact } from "../contacts/client-access";
import { notifyLeadAssigned, notifyNewLead } from "../notifications/telegram";
import { assertLeadAllowed } from "./lead-throttle";
import { visibilityWhere } from "./lead-visibility";
import {
  toLeadDetailDto,
  toLeadDto,
  toLeadNoteDto,
  type LeadRow,
} from "./lead-dto";
import { dealBookingInclude, dealDocumentInclude } from "./deal-dto";

/** Окно, в пределах которого повторная заявка с того же телефона помечается. */
const REPEAT_WINDOW_DAYS = 30;

/** Этап с развёрнутыми полями для DTO. */
const stageSelect = {
  select: { id: true, name: true, kind: true, funnelId: true },
} as const;
/** Стандартный include DTO заявки: этап + названия конструкции и источника. */
const leadInclude = {
  stage: stageSelect,
  construction: { select: { name: true } },
  sourceOption: { select: { name: true } },
  contact: { select: { fullName: true } },
} as const;
const noteAuthorInclude = { author: { select: { email: true } } } as const;

export interface ListLeadsResult {
  items: Lead[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Создаёт заявку (публичный путь с лендинга). Порядок: honeypot → анти-спам →
 * согласие ПДн → детект повторной (и авто-назначение менеджеру прошлой) →
 * входной этап → стартовое событие истории → уведомление в Telegram.
 *
 * Возвращает `null`, если заявка молча отклонена honeypot'ом (бот): вызывающий
 * роут всё равно отдаёт «успех», чтобы не подсказывать боту фильтр.
 */
export async function createLead(
  rt: Runtime,
  input: CreateLeadInput,
  meta: { ip: string },
): Promise<Lead | null> {
  // 1. Honeypot заполнен — это бот. Тихо «принимаем», в БД ничего не пишем.
  if (input.company && input.company.trim().length > 0) {
    return null;
  }

  // 2. Анти-спам по паре IP+телефон с потолком по IP (бросает 429).
  assertLeadAllowed(meta.ip, input.phone);

  // 3. Детект повторной заявки и возможное авто-назначение.
  const { isRepeat, assigneeId } = await resolveRepeat(rt, input.phone);

  // 4. Входной этап воронки.
  const stageId = await getEntryStageId(rt);

  // 5. Создание заявки + контакт-покупатель + стартовое событие истории — атомарно.
  const lead = await rt.prisma.$transaction(async (tx) => {
    // Контакт-покупатель: дедуп по телефону (существующему имя не перезаписываем).
    const contactId = await findOrCreateClientByPhone(tx, input.phone, input.name);
    const created = await tx.lead.create({
      data: {
        name: input.name,
        phone: input.phone,
        source: input.source,
        stageId,
        constructionId: input.constructionId ?? null,
        message: input.message ?? null,
        contactId,
        assigneeId,
        isRepeat,
        consentAt: new Date(),
        consentIp: meta.ip,
      },
      include: leadInclude,
    });
    await tx.leadStatusEvent.create({
      data: { leadId: created.id, stageId, authorId: null },
    });
    // Авто-назначение повторной прошлому менеджеру — фиксируем в истории
    // назначений (автор null = система).
    if (assigneeId) {
      await tx.leadAssignEvent.create({
        data: { leadId: created.id, assigneeId, authorId: null },
      });
    }
    return created;
  });

  // 6. Уведомления в Telegram — «выстрелил-и-забыл», сбой не ломает заявку:
  //    в чат отдела продаж (новая заявка) и лично прошлому менеджеру, если
  //    повторная авто-назначена ему (инициатор — система, actorId = null).
  void notifyNewLead(rt, lead);
  void notifyAssignment(rt, lead, assigneeId, null);

  return toLeadDto(lead);
}

/**
 * Ручной приём заявки в CRM (оффлайн: пришёл в офис / привёл партнёр). В отличие
 * от публичного `createLead`: без honeypot и анти-спам-троттла (оператор
 * доверенный), с опциональным реферером и явным ответственным. Согласие ПДн
 * подтверждает оператор (схема требует `consent: true`) — пишем `consentAt=now`,
 * `consentIp=""` (оффлайн, IP нет); аудит «кто принял» — автор стартового события
 * истории. Клиент-покупатель заводится/дедупится по телефону тем же путём, что и
 * при веб-приёме. Повторность (`isRepeat`) и авто-назначение прошлому менеджеру —
 * как на публичном пути; явно выбранный оператором ответственный имеет приоритет.
 */
export async function createManualLead(
  rt: Runtime,
  user: SessionUser,
  input: CreateManualLeadInput,
): Promise<Lead> {
  // Fail-fast: адресно назначить на ДРУГОГО менеджера может только admin (как в
  // assignLead). Чистая проверка прав без запросов к БД — раньше валидаций
  // реферера/ответственного, чтобы 403 не тонул за лишними чтениями и 422.
  if (input.assigneeId !== undefined && user.role !== "admin" && input.assigneeId !== user.id) {
    throw new HttpError(
      403,
      "forbidden",
      "Назначить заявку на другого менеджера может только администратор",
    );
  }

  if (input.referrerId && input.newReferrer) {
    throw new HttpError(
      422,
      "referrer_conflict",
      "Выберите существующего реферера или создайте нового, не оба варианта сразу",
    );
  }

  // Реферер (если задан) — действующий партнёр (та же проверка, что setLeadReferrer).
  if (input.referrerId) {
    const partner = await rt.prisma.contact.findUnique({ where: { id: input.referrerId } });
    if (!partner || partner.archivedAt || !partner.isPartner) {
      throw new HttpError(
        422,
        "invalid_referrer",
        "Реферером может быть только действующий партнёр",
      );
    }
  }

  // Источник ручного приёма — живой и не веб (веб-слаги шлёт только лендинг).
  await requireAssignableSource(rt, input.source, { forbidWeb: true });

  const selectedClient = input.contactId
    ? await requireManualClient(rt, user, input.contactId)
    : null;
  const leadName = selectedClient?.fullName ?? input.name;
  const leadPhone = selectedClient?.phone ?? input.phone;

  // Повторность + кандидат-ответственный по прошлой заявке (одним запросом).
  const repeat = await resolveRepeat(rt, leadPhone);

  // Ответственный: оператор может явно выбрать. Не задан — берём авто-кандидата
  // (прошлый менеджер повторной / общая очередь). Права уже проверены выше.
  let assigneeId: string | null;
  if (input.assigneeId === undefined) {
    assigneeId = repeat.assigneeId;
  } else {
    const assignee = await rt.prisma.user.findUnique({ where: { id: input.assigneeId } });
    if (!assignee || !assignee.isActive || assignee.role !== "manager") {
      throw new HttpError(
        422,
        "invalid_assignee",
        "Ответственным может быть только действующий менеджер",
      );
    }
    assigneeId = input.assigneeId;
  }

  // Входной этап выбранной оператором воронки (не задана — воронка по умолчанию).
  const stageId = await getEntryStageId(rt, input.funnelId);

  const lead = await rt.prisma.$transaction(async (tx) => {
    const contactId =
      selectedClient?.id ?? (await findOrCreateClientByPhone(tx, leadPhone, leadName, user.id));
    const referrerId = input.newReferrer
      ? (
          await tx.contact.create({
            data: {
              type: "individual",
              isClient: false,
              isPartner: true,
              fullName: input.newReferrer.fullName,
              phone: input.newReferrer.phone ?? null,
              createdById: user.id,
            },
            select: { id: true },
          })
        ).id
      : input.referrerId ?? null;
    const created = await tx.lead.create({
      data: {
        name: leadName,
        phone: leadPhone,
        source: input.source,
        stageId,
        constructionId: input.constructionId ?? null,
        message: input.message ?? null,
        contactId,
        referrerId,
        assigneeId,
        isRepeat: repeat.isRepeat,
        consentAt: new Date(),
        consentIp: "", // оффлайн-приём: IP нет, согласие подтвердил оператор
      },
      include: leadInclude,
    });
    // Автор стартового события — оператор (аудит ручного приёма), а не система.
    await tx.leadStatusEvent.create({
      data: { leadId: created.id, stageId, authorId: user.id },
    });
    // История назначений: явный выбор — от оператора, унаследованное от
    // повторной — системное (автор null).
    if (assigneeId) {
      await tx.leadAssignEvent.create({
        data: {
          leadId: created.id,
          assigneeId,
          authorId: input.assigneeId !== undefined ? user.id : null,
        },
      });
    }
    return created;
  });

  // Личное уведомление ответственному-менеджеру, если это не сам оператор.
  void notifyAssignment(rt, lead, assigneeId, user.id);

  return toLeadDto(lead);
}

/**
 * Помечает заявку повторной, если за последние 30 дней уже была заявка с тем
 * же телефоном, и подбирает ответственного: если самая свежая прошлая заявка
 * ещё активна (`in_progress`) и закреплена за действующим менеджером — новая
 * назначается ему же. Учётка admin исполнителем по умолчанию не выступает.
 */
async function resolveRepeat(
  rt: Runtime,
  phone: string,
): Promise<{ isRepeat: boolean; assigneeId: string | null }> {
  const since = new Date(Date.now() - REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const prior = await rt.prisma.lead.findFirst({
    where: { phone, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    include: {
      stage: { select: { kind: true } },
      assignee: { select: { id: true, role: true, isActive: true } },
    },
  });
  if (!prior) return { isRepeat: false, assigneeId: null };

  const a = prior.assignee;
  const inheritAssignee =
    a && a.isActive && a.role === "manager" && prior.stage.kind === "in_progress"
      ? a.id
      : null;
  return { isRepeat: true, assigneeId: inheritAssignee };
}

async function requireManualClient(
  rt: Runtime,
  user: SessionUser,
  contactId: string,
): Promise<{ id: string; fullName: string; phone: string }> {
  const contact = await rt.prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      isClient: true,
      fullName: true,
      phone: true,
      archivedAt: true,
      createdById: true,
    },
  });
  if (!contact || contact.archivedAt || !contact.isClient) {
    throw new HttpError(422, "invalid_client_contact", "Выберите действующего клиента");
  }
  if (!contact.phone) {
    throw new HttpError(
      422,
      "invalid_client_phone",
      "У выбранного клиента нет телефона — сначала заполните телефон в карточке клиента",
    );
  }
  if (!(await canAccessClientContact(rt, user, contact))) {
    throw new HttpError(404, "not_found", "Клиент не найден");
  }
  return { id: contact.id, fullName: contact.fullName, phone: contact.phone };
}

/** Кандидат-адресат личного уведомления о назначении. */
type NotifyAssignee = {
  id: string;
  role: string;
  isActive: boolean;
  telegramChatId: string | null;
} | null;

/**
 * Выбор адресата личного Telegram-уведомления о назначении заявки. Шлём, только
 * если новый ответственный — действующий менеджер с `telegramChatId` и это НЕ
 * сам инициатор действия (менеджер взял заявку себе — не уведомляем; admin себе
 * заявки не назначает). Возвращает chat id или `null` (не слать). Чистая
 * функция — покрыта юнит-тестом.
 */
export function assignmentNotifyChatId(
  assignee: NotifyAssignee,
  actorId: string | null,
): string | null {
  if (!assignee) return null;
  if (assignee.id === actorId) return null;
  if (!assignee.isActive || assignee.role !== "manager") return null;
  return assignee.telegramChatId ?? null;
}

/**
 * Fire-and-forget: уведомляет нового ответственного о назначенной заявке, если
 * он подходит по правилам `assignmentNotifyChatId`. Читает адресата из БД (только
 * когда назначение вообще есть); сбой отправки не влияет на основную операцию.
 */
async function notifyAssignment(
  rt: Runtime,
  lead: PrismaLead,
  assigneeId: string | null,
  actorId: string | null,
): Promise<void> {
  if (!assigneeId || assigneeId === actorId) return;
  // Полностью fail-safe: даже сбой чтения адресата не должен ломать приём/
  // назначение заявки (уведомление — вторичный эффект).
  try {
    const assignee = await rt.prisma.user.findUnique({
      where: { id: assigneeId },
      select: { id: true, role: true, isActive: true, telegramChatId: true },
    });
    const chatId = assignmentNotifyChatId(assignee, actorId);
    if (chatId) void notifyLeadAssigned(rt, lead, chatId);
  } catch (err) {
    console.error("[telegram] не удалось выбрать адресата уведомления:", err);
  }
}

/** Один день в миллисекундах — для окна «ближайшие 7 дней» повестки. */
const AGENDA_UPCOMING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * «Мой день»: активные заявки (`stage.kind=in_progress`), разложенные по дню
 * МСК на просроченные / сегодня / ближайшие 7 дней; заявки БЕЗ даты следующего
 * контакта — отдельной группой «без задачи» (иначе они не попадают ни в одну
 * повестку и молча теряются; старые сверху). Менеджер видит свою повестку;
 * admin — всю команду (`scope=all`, по умолчанию) либо только свою (`scope=mine`).
 */
export async function getAgenda(
  rt: Runtime,
  user: SessionUser,
  query: LeadAgendaQuery,
): Promise<LeadAgendaResponse> {
  // Видимость: менеджер — только свои заявки; admin — все или свои по scope.
  const ownOnly = user.role !== "admin" || query.scope === "mine";
  const scopeWhere: Prisma.LeadWhereInput = ownOnly ? { assigneeId: user.id } : {};
  const rows = await rt.prisma.lead.findMany({
    where: {
      AND: [scopeWhere, { stage: { kind: "in_progress" } }],
    },
    include: {
      stage: { select: { name: true } },
      nextContactType: { select: { name: true } },
    },
    // null-даты Postgres кладёт в конец при asc — порядок групп добиваем в коде.
    orderBy: [{ nextContactAt: "asc" }, { createdAt: "asc" }],
  });

  const today = mskDay(new Date());
  const upcomingCutoff = mskDay(new Date(Date.now() + AGENDA_UPCOMING_DAYS * DAY_MS));
  const groups: LeadAgendaResponse = { overdue: [], today: [], upcoming: [], noTask: [] };
  for (const row of rows) {
    const item: LeadAgendaItem = {
      id: row.id,
      name: row.name,
      phone: row.phone,
      stageName: row.stage.name,
      nextContactAt: row.nextContactAt ? row.nextContactAt.toISOString() : null,
      nextContactTypeName: row.nextContactType?.name ?? null,
    };
    if (!row.nextContactAt) {
      groups.noTask.push(item);
      continue;
    }
    const day = mskDay(row.nextContactAt);
    if (day < today) groups.overdue.push(item);
    else if (day === today) groups.today.push(item);
    else if (day <= upcomingCutoff) groups.upcoming.push(item);
    // Дальше 7 дней — вне повестки «Моего дня».
  }
  return groups;
}

/** Список заявок CRM: видимость + фильтры + поиск + пагинация (25/стр). */
export async function listLeads(
  rt: Runtime,
  user: SessionUser,
  query: ListLeadsQuery,
): Promise<ListLeadsResult> {
  const filters: Prisma.LeadWhereInput[] = [visibilityWhere(user)];
  if (query.stageId) filters.push({ stageId: query.stageId });
  // Фильтр по воронке — через этап заявки (без денормализации funnelId на Lead).
  if (query.funnelId) filters.push({ stage: { funnelId: query.funnelId } });
  if (query.source) filters.push({ source: query.source });
  if (query.constructionId) filters.push({ constructionId: query.constructionId });
  // "none" — только очередь (не назначенные); иначе конкретный ответственный.
  if (query.assigneeId) {
    filters.push({ assigneeId: query.assigneeId === "none" ? null : query.assigneeId });
  }
  if (query.referrerId) filters.push({ referrerId: query.referrerId });
  if (query.from || query.to) {
    filters.push({
      createdAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    });
  }
  if (query.search) {
    const term = query.search;
    const or: Prisma.LeadWhereInput[] = [
      { name: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
    ];
    // Телефон хранится нормализованным (`+7XXXXXXXXXX`), а ищут как привыкли:
    // «8 912 …», «+7 (912) …». Извлекаем цифры (ведущую 8 меняем на 7) и ищем
    // по ним тоже — иначе поиск по телефону работал бы только в каноническом виде.
    const digits = normalizePhoneSearch(term);
    if (digits) or.push({ phone: { contains: digits } });
    filters.push({ OR: or });
  }

  const where: Prisma.LeadWhereInput = { AND: filters };
  const [rows, total] = await Promise.all([
    rt.prisma.lead.findMany({
      where,
      include: leadInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    rt.prisma.lead.count({ where }),
  ]);
  return {
    items: rows.map(toLeadDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/**
 * Цифровой терм для поиска по телефону: выдёргивает цифры из ввода, ведущую
 * `8` приводит к `7` (хранение — `+7…`). Меньше 3 цифр — не телефонный запрос,
 * возвращаем `null` (иначе однозначный «1» матчил бы полбазы).
 */
export function normalizePhoneSearch(term: string): string | null {
  const digits = term.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return digits.replace(/^8/, "7");
}

/**
 * Нейтрализация CSV-инъекции: Excel исполняет ячейки, начинающиеся с `=`/`@`
 * (а `+`/`-` — если дальше не число), как формулы, а имя заявки приходит с
 * публичного лендинга. Префикс «'» заставляет Excel показать значение текстом.
 * Телефоны вида `+79…` — легитимные числа, их не трогаем.
 */
function defangFormula(value: string): string {
  if (/^[=@]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && !/^[+-]\d+$/.test(value)) return `'${value}`;
  return value;
}

/** Экранирование значения для CSV (RFC 4180): кавычки и разделители. */
export function csvCell(value: string): string {
  const safe = defangFormula(value);
  if (/[",\n;]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/**
 * Выгрузка заявок в CSV с учётом тех же фильтров и видимости, что и список.
 * UTF-8 + BOM и запятая — корректно открывается в Excel. Без пагинации, но с
 * предохранительным потолком строк; при его превышении последняя строка файла
 * явно сообщает об обрезке (иначе неполная выгрузка выглядела бы как полная).
 */
export async function exportLeadsCsv(
  rt: Runtime,
  user: SessionUser,
  query: ListLeadsQuery,
): Promise<string> {
  const { items, total } = await listLeads(rt, user, {
    ...query,
    page: 1,
    pageSize: 5000,
  });
  const ids = items.map((l) => l.assigneeId).filter((v): v is string => !!v);
  const assignees = ids.length
    ? await rt.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      })
    : [];
  const emailById = new Map(assignees.map((a) => [a.id, a.email]));

  const header = [
    "Дата",
    "Имя",
    "Телефон",
    "Источник",
    "Конструкция",
    "Этап",
    "Ответственный",
    "Повторная",
  ];
  const rows = items.map((l) =>
    [
      new Date(l.createdAt).toLocaleString("ru-RU"),
      l.name,
      l.phone,
      l.sourceName ?? l.source,
      l.constructionName ?? "",
      l.stage.name,
      l.assigneeId ? emailById.get(l.assigneeId) ?? "" : "",
      l.isRepeat ? "да" : "нет",
    ]
      .map((cell) => csvCell(String(cell)))
      .join(","),
  );
  if (total > items.length) {
    rows.push(
      csvCell(
        `Выгружены первые ${items.length} из ${total} заявок — сузьте фильтры`,
      ),
    );
  }
  // BOM, чтобы Excel распознал UTF-8.
  return "﻿" + [header.join(","), ...rows].join("\r\n");
}

/**
 * Карточка заявки: данные + заметки + история смен статуса + связанные по
 * телефону (read-only). Менеджер может открыть свою/неназначенную заявку, а
 * также чужую — если по этому телефону у него есть видимая заявка (связанная).
 */
export async function getLeadDetail(
  rt: Runtime,
  user: SessionUser,
  id: string,
): Promise<LeadDetail | null> {
  const lead = await rt.prisma.lead.findUnique({
    where: { id },
    include: leadInclude,
  });
  if (!lead) return null;

  if (!(await canViewLead(rt, user, lead))) return null;
  const canAccessDealDocuments = canEditLead(user, lead);

  const [notes, statusHistory, assignHistory, contactHistory, related, referrer, bookings, dealDocuments] = await Promise.all([
    rt.prisma.leadNote.findMany({
      where: { leadId: id },
      include: noteAuthorInclude,
      orderBy: { createdAt: "asc" },
    }),
    rt.prisma.leadStatusEvent.findMany({
      where: { leadId: id },
      include: { stage: stageSelect, author: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    rt.prisma.leadAssignEvent.findMany({
      where: { leadId: id },
      include: {
        assignee: { select: { name: true, email: true } },
        author: { select: { email: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    rt.prisma.leadContactEvent.findMany({
      where: { leadId: id },
      include: { author: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    rt.prisma.lead.findMany({
      where: { phone: lead.phone, id: { not: id } },
      include: leadInclude,
      orderBy: { createdAt: "desc" },
    }),
    lead.referrerId
      ? rt.prisma.contact.findUnique({
          where: { id: lead.referrerId },
          select: { id: true, fullName: true, type: true },
        })
      : Promise.resolve(null),
    rt.prisma.booking.findMany({
      where: { leadId: id },
      include: dealBookingInclude,
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
    canAccessDealDocuments
      ? rt.prisma.dealDocument.findMany({
          where: { leadId: id },
          include: dealDocumentInclude,
          orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  return toLeadDetailDto({
    lead,
    notes,
    statusHistory,
    assignHistory,
    contactHistory,
    related,
    referrer,
    bookings,
    dealDocuments,
    canAccessDealDocuments,
  });
}

/**
 * Назначить/снять реферера заявки (контрагент с ролью партнёра). Требует
 * прав на редактирование. `referrerId = null` — снять привязку.
 */
export async function setLeadReferrer(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: SetLeadReferrerInput,
): Promise<Lead | null> {
  const existing = await rt.prisma.lead.findUnique({ where: { id } });
  if (!existing) return null;
  assertCanEdit(user, existing);

  if (input.referrerId !== null) {
    const partner = await rt.prisma.contact.findUnique({
      where: { id: input.referrerId },
    });
    if (!partner || partner.archivedAt || !partner.isPartner) {
      throw new HttpError(
        422,
        "invalid_referrer",
        "Реферером может быть только действующий партнёр",
      );
    }
  }

  const lead = await rt.prisma.lead.update({
    where: { id },
    data: { referrerId: input.referrerId },
    include: leadInclude,
  });
  return toLeadDto(lead);
}

/** Видна ли заявка пользователю (для чтения карточки). */
async function canViewLead(
  rt: Runtime,
  user: SessionUser,
  lead: { phone: string; assigneeId: string | null },
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (lead.assigneeId === user.id || lead.assigneeId === null) return true;
  // Чужая заявка видна read-only, если по этому телефону есть видимая заявка.
  const relatedVisible = await rt.prisma.lead.findFirst({
    where: {
      phone: lead.phone,
      OR: [{ assigneeId: user.id }, { assigneeId: null }],
    },
    select: { id: true },
  });
  return relatedVisible !== null;
}

/** Может ли пользователь редактировать заявку (своя/неназначенная/admin). */
export function canEditLead(
  user: SessionUser,
  lead: { assigneeId: string | null },
): boolean {
  return user.role === "admin" || lead.assigneeId === user.id || lead.assigneeId === null;
}

export function assertCanEdit(
  user: SessionUser,
  lead: { assigneeId: string | null },
): void {
  if (canEditLead(user, lead)) return;
  throw new HttpError(403, "forbidden", "Заявку ведёт другой менеджер");
}

/**
 * Переводит заявку на другой этап. Пишет событие истории (автор — текущий
 * пользователь). При переходе в терминальный этап (won/lost) снимает дату
 * следующего контакта — закрытая заявка не нуждается в напоминании. Целевым
 * может быть любой живой этап, в т.ч. из другой воронки (штатное перемещение
 * между воронками, напр. чтобы освободить воронку под архивацию).
 */
export async function updateLeadStage(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: UpdateLeadStageInput,
): Promise<Lead | null> {
  const existing = await rt.prisma.lead.findUnique({ where: { id } });
  if (!existing) return null;
  assertCanEdit(user, existing);

  const stage = await rt.prisma.stage.findUnique({
    where: { id: input.stageId },
  });
  if (!stage || stage.archivedAt) {
    throw new HttpError(422, "invalid_stage", "Этап не найден");
  }

  const lead = await rt.prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: {
        stageId: input.stageId,
        // Закрытая заявка уходит из активной работы — дата и тип контакта не нужны.
        nextContactAt: stage.kind === "in_progress" ? undefined : null,
        nextContactTypeId: stage.kind === "in_progress" ? undefined : null,
      },
      include: leadInclude,
    });
    await tx.leadStatusEvent.create({
      data: { leadId: id, stageId: input.stageId, authorId: user.id },
    });
    // Закрытие снимает назначенное напоминание — фиксируем в истории задач,
    // иначе в ленте оно исчезло бы «молча».
    if (stage.kind !== "in_progress" && existing.nextContactAt !== null) {
      await tx.leadContactEvent.create({
        data: { leadId: id, kind: "cleared", at: null, typeName: null, authorId: user.id },
      });
    }
    return updated;
  });
  return toLeadDto(lead);
}

/**
 * Назначение ответственного. Менеджер может взять заявку себе или вернуть в
 * общую очередь (`assigneeId = null`); адресно назначить на другого менеджера
 * может только admin. Целевой пользователь должен быть действующим менеджером.
 */
export async function assignLead(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: AssignLeadInput,
): Promise<Lead | null> {
  const existing = await rt.prisma.lead.findUnique({ where: { id } });
  if (!existing) return null;

  const target = input.assigneeId;
  if (user.role !== "admin") {
    const takingSelf = target === user.id;
    const releasing = target === null;
    if (!takingSelf && !releasing) {
      throw new HttpError(
        403,
        "forbidden",
        "Назначить заявку на другого менеджера может только администратор",
      );
    }
    // Вернуть в очередь может admin или текущий ответственный.
    if (releasing) assertCanEdit(user, existing);
    // Взять себе можно свою или неназначенную.
    if (takingSelf) assertCanEdit(user, existing);
  }

  if (target !== null) {
    const assignee = await rt.prisma.user.findUnique({ where: { id: target } });
    if (!assignee || !assignee.isActive || assignee.role !== "manager") {
      throw new HttpError(
        422,
        "invalid_assignee",
        "Ответственным может быть только действующий менеджер",
      );
    }
  }

  const lead = await rt.prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { assigneeId: target },
      include: leadInclude,
    });
    await tx.leadAssignEvent.create({
      data: { leadId: id, assigneeId: target, authorId: user.id },
    });
    return updated;
  });

  // Личное уведомление новому ответственному, если это не сам инициатор.
  void notifyAssignment(rt, lead, target, user.id);

  return toLeadDto(lead);
}

/**
 * Задать/снять дату следующего контакта и его тип (справочник ContactType).
 * Снятие даты сбрасывает и тип. Требует прав на редактирование.
 */
export async function updateNextContact(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: UpdateNextContactInput,
): Promise<Lead | null> {
  const existing = await rt.prisma.lead.findUnique({ where: { id } });
  if (!existing) return null;
  assertCanEdit(user, existing);

  const at = input.nextContactAt ? new Date(input.nextContactAt) : null;
  // Без даты тип не нужен; иначе берём из ввода (если поле передано).
  let typeId: string | null | undefined;
  if (at === null) typeId = null;
  else if (input.nextContactTypeId !== undefined)
    typeId = input.nextContactTypeId || null;

  // Уже назначенный тип (возможно, ставший архивным) сохранять можно — иначе
  // нельзя было бы просто подвинуть дату напоминания. Запрещаем лишь НАЗНАЧЕНИЕ
  // нового архивного/несуществующего типа.
  if (typeId && typeId !== existing.nextContactTypeId) {
    const type = await rt.prisma.contactType.findUnique({ where: { id: typeId } });
    if (!type || type.archivedAt) {
      throw new HttpError(422, "invalid_contact_type", "Тип контакта не найден");
    }
  }

  // Итоговый тип после апдейта (undefined в data = «оставить как было»).
  const finalTypeId = typeId !== undefined ? typeId : existing.nextContactTypeId;
  // Событие истории — только при реальном изменении даты/типа: повторное
  // «Сохранить» без правок не должно засорять ленту.
  const changed =
    (existing.nextContactAt?.getTime() ?? null) !== (at?.getTime() ?? null) ||
    existing.nextContactTypeId !== finalTypeId;
  // Снятие и так не назначенного напоминания — тоже не событие.
  const meaningful = changed && !(at === null && existing.nextContactAt === null);

  // Имя типа снимком в событие (архивация справочника не сломает историю).
  const typeName =
    meaningful && at !== null && finalTypeId
      ? (await rt.prisma.contactType.findUnique({ where: { id: finalTypeId } }))?.name ?? null
      : null;

  const lead = await rt.prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { nextContactAt: at, nextContactTypeId: typeId },
      include: leadInclude,
    });
    if (meaningful) {
      await tx.leadContactEvent.create({
        data: {
          leadId: id,
          kind: at !== null ? "scheduled" : "cleared",
          at,
          typeName,
          authorId: user.id,
        },
      });
    }
    return updated;
  });
  return toLeadDto(lead);
}

/**
 * Итог назначенного контакта: состоялся (`done`) / отменён (`cancelled`).
 * Пишет событие в историю задач (с датой и типом выполненной задачи) и снимает
 * напоминание — следующий контакт менеджер назначает сам (забыл — заявка
 * всплывёт в «Без задачи» «Моего дня»).
 */
export async function completeNextContact(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: CompleteNextContactInput,
): Promise<Lead | null> {
  const existing = await rt.prisma.lead.findUnique({ where: { id } });
  if (!existing) return null;
  assertCanEdit(user, existing);
  if (existing.nextContactAt === null) {
    throw new HttpError(422, "no_next_contact", "Контакт не назначен — отмечать нечего");
  }

  // Снимок имени типа выполненной задачи (тип мог уйти в архив — имя сохраняем).
  const typeName = existing.nextContactTypeId
    ? (
        await rt.prisma.contactType.findUnique({
          where: { id: existing.nextContactTypeId },
        })
      )?.name ?? null
    : null;

  const lead = await rt.prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: { nextContactAt: null, nextContactTypeId: null },
      include: leadInclude,
    });
    await tx.leadContactEvent.create({
      data: {
        leadId: id,
        kind: input.outcome,
        at: existing.nextContactAt,
        typeName,
        authorId: user.id,
      },
    });
    return updated;
  });
  return toLeadDto(lead);
}

/** Сменить источник заявки вручную. Требует прав на редактирование. */
export async function updateLeadSource(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: UpdateLeadSourceInput,
): Promise<Lead | null> {
  const existing = await rt.prisma.lead.findUnique({ where: { id } });
  if (!existing) return null;
  assertCanEdit(user, existing);
  // Целевой источник — живой (веб разрешён: правка канала — уточнение факта).
  await requireAssignableSource(rt, input.source);
  const lead = await rt.prisma.lead.update({
    where: { id },
    data: { source: input.source },
    include: leadInclude,
  });
  return toLeadDto(lead);
}

/** Сменить или снять конструкцию сделки. Требует прав на редактирование заявки. */
export async function updateLeadConstruction(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: UpdateLeadConstructionInput,
): Promise<Lead | null> {
  const existing = await rt.prisma.lead.findUnique({ where: { id } });
  if (!existing) return null;
  assertCanEdit(user, existing);

  if (
    input.constructionId !== null &&
    input.constructionId !== existing.constructionId
  ) {
    const construction = await rt.prisma.construction.findUnique({
      where: { id: input.constructionId },
    });
    if (!construction || construction.archivedAt) {
      throw new HttpError(422, "invalid_construction", "Конструкция не найдена");
    }
  }

  const lead = await rt.prisma.lead.update({
    where: { id },
    data: { constructionId: input.constructionId },
    include: leadInclude,
  });
  return toLeadDto(lead);
}

/** Добавить заметку в карточку (автор — текущий пользователь). */
export async function addNote(
  rt: Runtime,
  user: SessionUser,
  leadId: string,
  input: CreateNoteInput,
): Promise<LeadNote | null> {
  const lead = await rt.prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return null;
  assertCanEdit(user, lead);
  const note = await rt.prisma.leadNote.create({
    data: { leadId, authorId: user.id, text: input.text },
    include: noteAuthorInclude,
  });
  return toLeadNoteDto(note);
}

/** Редактировать заметку: автор — свою, admin — любую. */
export async function updateNote(
  rt: Runtime,
  user: SessionUser,
  noteId: string,
  input: UpdateNoteInput,
): Promise<LeadNote | null> {
  const note = await requireOwnNote(rt, user, noteId);
  const updated = await rt.prisma.leadNote.update({
    where: { id: noteId },
    data: { text: input.text },
    include: noteAuthorInclude,
  });
  return toLeadNoteDto(updated);
}

/** Удалить заметку: автор — свою, admin — любую. */
export async function deleteNote(
  rt: Runtime,
  user: SessionUser,
  noteId: string,
): Promise<void> {
  await requireOwnNote(rt, user, noteId);
  await rt.prisma.leadNote.delete({ where: { id: noteId } });
}

async function requireOwnNote(rt: Runtime, user: SessionUser, noteId: string) {
  const note = await rt.prisma.leadNote.findUnique({ where: { id: noteId } });
  if (!note) throw new HttpError(404, "not_found", "Заметка не найдена");
  if (user.role !== "admin" && note.authorId !== user.id) {
    throw new HttpError(403, "forbidden", "Можно редактировать только свои заметки");
  }
  return note;
}

export interface LeadStats {
  total: number;
  byStage: Record<string, number>;
  bySource: Record<string, number>;
}

/** Сводная аналитика заявок (основа сервиса аналитики Вехи 5). */
export async function getLeadStats(
  rt: Runtime,
  user: SessionUser,
): Promise<LeadStats> {
  const where = visibilityWhere(user);
  const [total, byStageRows, bySourceRows] = await Promise.all([
    rt.prisma.lead.count({ where }),
    rt.prisma.lead.groupBy({ by: ["stageId"], where, _count: { _all: true } }),
    rt.prisma.lead.groupBy({ by: ["source"], where, _count: { _all: true } }),
  ]);
  const byStage: Record<string, number> = {};
  for (const row of byStageRows) byStage[row.stageId] = row._count._all;
  const bySource: Record<string, number> = {};
  for (const row of bySourceRows) bySource[row.source] = row._count._all;
  return { total, byStage, bySource };
}
