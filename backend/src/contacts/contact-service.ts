import type {
  Contact,
  ContactDetail,
  ContactLeadRef,
  CounterpartyType,
  ListContactsQuery,
  SessionUser,
  UpsertContactInput,
} from "@noesis/contracts";
import { normalizeRuPhone } from "@noesis/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { normalizePhoneSearch } from "../http/phone-search";
import { visibilityWhere } from "../leads/lead-visibility";
import { canAccessClientContact, clientContactAccessWhere } from "./client-access";
import {
  toContactDto,
  type ContactAggregates,
  type ContactRow,
  type LatestLeadRow,
} from "./contact-dto";

const organizationInclude = { organization: { select: { fullName: true } } } as const;
const stageSelect = {
  select: { id: true, name: true, kind: true, funnelId: true },
} as const;

function nullableText(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value || null;
}

function passportData(type: CounterpartyType, input: UpsertContactInput) {
  if (type !== "individual") {
    return {
      birthDate: null,
      birthPlace: null,
      passportSeries: null,
      passportNumber: null,
      passportIssuedBy: null,
      passportIssuedAt: null,
      passportDepartmentCode: null,
      registrationAddress: null,
      actualAddress: null,
    };
  }
  return {
    birthDate: nullableText(input.birthDate),
    birthPlace: nullableText(input.birthPlace),
    passportSeries: nullableText(input.passportSeries),
    passportNumber: nullableText(input.passportNumber),
    passportIssuedBy: nullableText(input.passportIssuedBy),
    passportIssuedAt: nullableText(input.passportIssuedAt),
    passportDepartmentCode: nullableText(input.passportDepartmentCode),
    registrationAddress: nullableText(input.registrationAddress),
    actualAddress: nullableText(input.actualAddress),
  };
}

function requisitesData(type: CounterpartyType, input: UpsertContactInput) {
  const bank = {
    bankName: nullableText(input.bankName),
    bankBik: nullableText(input.bankBik),
    bankAccount: nullableText(input.bankAccount),
    correspondentAccount: nullableText(input.correspondentAccount),
  };
  if (type !== "company") {
    return {
      legalName: null,
      inn: null,
      kpp: null,
      ogrn: null,
      legalAddress: null,
      postalAddress: null,
      directorTitle: null,
      directorFullName: null,
      directorBasis: null,
      ...bank,
    };
  }
  return {
    legalName: nullableText(input.legalName),
    inn: nullableText(input.inn),
    kpp: nullableText(input.kpp),
    ogrn: nullableText(input.ogrn),
    legalAddress: nullableText(input.legalAddress),
    postalAddress: nullableText(input.postalAddress),
    directorTitle: nullableText(input.directorTitle),
    directorFullName: nullableText(input.directorFullName),
    directorBasis: nullableText(input.directorBasis),
    ...bank,
  };
}

/**
 * Список контактов: фильтр по типу/поиску/архиву + видимость. Партнёры
 * с ролью партнёра видны всем сотрудникам; клиенты — менеджеру только если у
 * него есть видимая заявка этого клиента (свои/неназначенные), admin — все.
 *
 * Агрегаты заявок-покупателей (счётчик, свежайшая заявка) считаем по видимым
 * заявкам — как это делал прежний агрегат «клиента». `referredCount` — общее
 * число приведённых заявок (директория партнёров), точные срезы по менеджеру —
 * в модуле аналитики партнёров.
 */
export async function listContacts(
  rt: Runtime,
  user: SessionUser,
  query: ListContactsQuery = {},
): Promise<Contact[]> {
  const filters: Prisma.ContactWhereInput[] = [];
  if (query.type) filters.push({ type: query.type });
  if (query.role === "client") filters.push({ isClient: true });
  if (query.role === "partner") filters.push({ isPartner: true });
  if (!(query.includeArchived && user.role === "admin")) {
    filters.push({ archivedAt: null });
  }
  if (query.search) {
    const term = query.search;
    const digits = normalizePhoneSearch(term);
    const or: Prisma.ContactWhereInput[] = [
      { fullName: { contains: term, mode: "insensitive" } },
      { legalName: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
    ];
    if (digits) or.push({ phone: { contains: digits } });
    filters.push({
      OR: or,
    });
  }
  // Видимость: клиент-контакт виден менеджеру через видимую заявку или как свободный
  // вручную созданный клиент до первой привязки сделки.
  if (user.role !== "admin") {
    filters.push({
      OR: [
        { isPartner: true },
        { isClient: true, ...clientContactAccessWhere(user) },
      ],
    });
  }

  const rows = (await rt.prisma.contact.findMany({
    where: { AND: filters },
    include: { ...organizationInclude, _count: { select: { referredLeads: true } } },
    orderBy: [{ createdAt: "desc" }],
  })) as (ContactRow & { _count: { referredLeads: number } })[];

  // Агрегаты по заявкам-покупателям одним запросом (с учётом видимости).
  const clientIds = rows.filter((r) => r.isClient).map((r) => r.id);
  const leadAgg = await aggregateBuyerLeads(rt, user, clientIds);

  return rows.map((row) =>
    toContactDto(row, {
      leadsCount: leadAgg.get(row.id)?.count ?? 0,
      referredCount: row._count.referredLeads,
      latestLead: leadAgg.get(row.id)?.latest,
    }),
  );
}

/** Счётчик + свежайшая видимая заявка по каждому контакту-покупателю. */
async function aggregateBuyerLeads(
  rt: Runtime,
  user: SessionUser,
  contactIds: string[],
): Promise<Map<string, { count: number; latest: LatestLeadRow }>> {
  const out = new Map<string, { count: number; latest: LatestLeadRow }>();
  if (contactIds.length === 0) return out;
  const leads = await rt.prisma.lead.findMany({
    where: { AND: [{ contactId: { in: contactIds } }, visibilityWhere(user)] },
    select: {
      id: true,
      contactId: true,
      createdAt: true,
      source: true,
      sourceOption: { select: { name: true } },
      assigneeId: true,
      stage: stageSelect,
    },
    orderBy: { createdAt: "desc" },
  });
  for (const lead of leads) {
    if (!lead.contactId) continue;
    const cur = out.get(lead.contactId);
    if (!cur) {
      // Первая встреченная — самая свежая (сортировка desc).
      out.set(lead.contactId, { count: 1, latest: lead });
    } else {
      cur.count += 1;
    }
  }
  return out;
}

/** Выборка краткой строки заявки для карточки контакта. */
const contactLeadSelect = {
  id: true,
  name: true,
  createdAt: true,
  source: true,
  sourceOption: { select: { name: true } },
  constructionId: true,
  construction: { select: { name: true } },
  assigneeId: true,
  stage: stageSelect,
} as const;

/** Потолок заявок в карточке контакта (защита от гигантских историй). */
const CONTACT_LEADS_LIMIT = 100;

/**
 * Полная карточка контакта: DTO + заявки. Для клиента — его заявки-покупателя,
 * для партнёра — приведённые; оба списка режутся видимостью пользователя.
 */
export async function getContactDetail(
  rt: Runtime,
  user: SessionUser,
  id: string,
): Promise<ContactDetail> {
  const row = await requireContact(rt, id);
  await assertContactVisible(rt, user, row);
  const base = await contactDto(rt, user, row);

  const toRef = (l: {
    id: string;
    name: string;
    createdAt: Date;
    source: string;
    sourceOption: { name: string } | null;
    construction: { name: string } | null;
    assigneeId: string | null;
    stage: { id: string; name: string; kind: "in_progress" | "won" | "lost"; funnelId: string };
  }): ContactLeadRef => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt.toISOString(),
    stage: l.stage,
    source: l.source,
    sourceName: l.sourceOption?.name ?? null,
    projectName: l.construction?.name ?? null,
    assigneeId: l.assigneeId,
  });

  const [buyerLeads, referredLeads] = await Promise.all([
    row.isClient
      ? rt.prisma.lead.findMany({
          where: { AND: [{ contactId: id }, visibilityWhere(user)] },
          select: contactLeadSelect,
          orderBy: { createdAt: "desc" },
          take: CONTACT_LEADS_LIMIT,
        })
      : Promise.resolve([]),
    row.isPartner
      ? rt.prisma.lead.findMany({
          where: { AND: [{ referrerId: id }, visibilityWhere(user)] },
          select: contactLeadSelect,
          orderBy: { createdAt: "desc" },
          take: CONTACT_LEADS_LIMIT,
        })
      : Promise.resolve([]),
  ]);

  return {
    ...base,
    leads: buyerLeads.map(toRef),
    referredLeads: referredLeads.map(toRef),
  };
}

/** Загрузить контрагента с представляющей компанией или бросить 404. */
async function requireContact(rt: Runtime, id: string): Promise<ContactRow> {
  const row = await rt.prisma.contact.findUnique({
    where: { id },
    include: organizationInclude,
  });
  if (!row) throw new HttpError(404, "not_found", "Контакт не найден");
  return row;
}

/**
 * Guard видимости для операций записи над контактом-клиентом: та же граница,
 * что в `listContacts`. Партнёры видны всем сотрудникам; клиент
 * доступен менеджеру только через видимую ему заявку (свою/неназначенную), admin
 * — всегда. Невидимый клиент → 404 (как будто его нет), чтобы правка/архив по id
 * не читали/меняли ПДн чужого клиента и не палили его существование.
 */
async function assertContactVisible(
  rt: Runtime,
  user: SessionUser,
  contact: ContactRow,
): Promise<void> {
  if (user.role === "admin" || contact.isPartner || !contact.isClient) return;
  if (await canAccessClientContact(rt, user, contact)) return;
  throw new HttpError(404, "not_found", "Контакт не найден");
}

/** DTO одного контакта с досчётом агрегатов. */
async function contactDto(
  rt: Runtime,
  user: SessionUser,
  row: ContactRow,
): Promise<Contact> {
  const [leadsCount, referredCount, latestLead] = await Promise.all([
    row.isClient
      ? rt.prisma.lead.count({
          where: { AND: [{ contactId: row.id }, visibilityWhere(user)] },
        })
      : Promise.resolve(0),
    rt.prisma.lead.count({ where: { referrerId: row.id } }),
    row.isClient
      ? rt.prisma.lead.findFirst({
          where: { AND: [{ contactId: row.id }, visibilityWhere(user)] },
          select: {
            id: true,
            createdAt: true,
            source: true,
            sourceOption: { select: { name: true } },
            assigneeId: true,
            stage: stageSelect,
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve(null),
  ]);
  const agg: ContactAggregates = {
    leadsCount,
    referredCount,
    latestLead: latestLead ?? undefined,
  };
  return toContactDto(row, agg);
}

/** Проверяет связь представителя с живой компанией, запрещая самоссылки. */
async function resolveOrganizationId(
  rt: Runtime,
  type: CounterpartyType,
  isPartner: boolean,
  organizationId: string | null | undefined,
  selfId: string | null,
  currentOrganizationId: string | null = null,
): Promise<string | null | undefined> {
  if (organizationId === undefined) {
    return type === "individual" && isPartner ? undefined : null;
  }
  if (organizationId === null) return null;
  if (type !== "individual" || !isPartner) {
    throw new HttpError(
      422,
      "organization_not_allowed",
      "Компанию можно указать только у партнёра-человека",
    );
  }
  if (selfId && organizationId === selfId) {
    throw new HttpError(422, "organization_self", "Контрагент не может представлять сам себя");
  }
  const organization = await rt.prisma.contact.findUnique({ where: { id: organizationId } });
  const unchanged = organizationId === currentOrganizationId;
  if (!organization || organization.type !== "company" || (organization.archivedAt && !unchanged)) {
    throw new HttpError(422, "invalid_organization", "Компания не найдена");
  }
  return organizationId;
}

/** Не даёт снять используемую роль или сменить вид компании с представителями. */
async function assertRoleChangeAllowed(
  rt: Runtime,
  id: string,
  current: ContactRow,
  input: UpsertContactInput,
): Promise<void> {
  if (current.isClient && !input.isClient) {
    const asBuyer = await rt.prisma.lead.count({ where: { contactId: id } });
    if (asBuyer > 0) {
      throw new HttpError(
        409,
        "client_role_in_use",
        `К контрагенту привязаны заявки клиента (${asBuyer}). Сначала перепривяжите их.`,
      );
    }
  }
  if (current.isPartner && !input.isPartner) {
    const asReferrer = await rt.prisma.lead.count({ where: { referrerId: id } });
    if (asReferrer > 0) {
      throw new HttpError(
        409,
        "partner_role_in_use",
        `Контрагент указан партнёром в заявках (${asReferrer}). Сначала перепривяжите их.`,
      );
    }
  }
  if (current.type === "company" && input.type !== "company") {
    const representatives = await rt.prisma.contact.count({ where: { organizationId: id } });
    if (representatives > 0) {
      throw new HttpError(
        409,
        "company_in_use",
        `Компанию представляют контрагенты (${representatives}). Сначала перепривяжите их.`,
      );
    }
  }
}

/** Создать контрагента. У клиента обязателен телефон и нет дублей. */
export async function createContact(
  rt: Runtime,
  user: SessionUser,
  input: UpsertContactInput,
): Promise<Contact> {
  const phone = normalizePhone(input.phone);
  const clientPhone = requireClientPhone(input.isClient, phone);
  const restored = await restoreDuplicateArchivedClient(rt, user, input, clientPhone);
  if (restored) return restored;
  await assertNoDuplicateClientPhone(rt, user, clientPhone);
  const organizationId = await resolveOrganizationId(
    rt,
    input.type,
    input.isPartner,
    input.organizationId,
    null,
  );
  const row = await rt.prisma.contact.create({
    data: {
      type: input.type,
      isClient: input.isClient,
      isPartner: input.isPartner,
      fullName: input.fullName,
      phone,
      organizationId: organizationId ?? null,
      createdById: user.id,
      note: input.note ?? null,
      ...passportData(input.type, input),
      ...requisitesData(input.type, input),
      lastInteractionAt: input.lastInteractionAt ? new Date(input.lastInteractionAt) : null,
    },
    include: organizationInclude,
  });
  return contactDto(rt, user, row);
}

/** Обновить контакт (оптимистичная блокировка по `expectedUpdatedAt`). */
export async function updateContact(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: UpsertContactInput,
): Promise<Contact> {
  const current = await requireContact(rt, id);
  await assertContactVisible(rt, user, current);
  assertFresh(current.updatedAt, input.expectedUpdatedAt);
  await assertRoleChangeAllowed(rt, id, current, input);
  const organizationId = await resolveOrganizationId(
    rt,
    input.type,
    input.isPartner,
    input.organizationId,
    id,
    current.organizationId,
  );
  const phone = normalizePhone(input.phone);
  const clientPhone = requireClientPhone(input.isClient, phone);
  await assertClientPhoneChangeAllowed(rt, id, current.isClient, current.phone, phone);
  await assertNoDuplicateClientPhone(rt, user, clientPhone, id);
  const row = await rt.prisma.contact.update({
    where: { id },
    data: {
      type: input.type,
      isClient: input.isClient,
      isPartner: input.isPartner,
      fullName: input.fullName,
      phone,
      organizationId,
      note: input.note ?? null,
      ...passportData(input.type, input),
      ...requisitesData(input.type, input),
      lastInteractionAt:
        input.lastInteractionAt === undefined
          ? undefined
          : input.lastInteractionAt
            ? new Date(input.lastInteractionAt)
            : null,
    },
    include: organizationInclude,
  });
  return contactDto(rt, user, row);
}

/** Архивировать контакт (скрыть из выбора; ссылки заявок целы). */
export async function archiveContact(
  rt: Runtime,
  user: SessionUser,
  id: string,
): Promise<Contact> {
  const current = await requireContact(rt, id);
  await assertContactVisible(rt, user, current);
  if (current.archivedAt) throw new HttpError(409, "already_archived", "Контакт уже в архиве");
  const row = await rt.prisma.contact.update({
    where: { id },
    data: { archivedAt: new Date() },
    include: organizationInclude,
  });
  return contactDto(rt, user, row);
}

/** Восстановить контакт из архива. */
export async function restoreContact(
  rt: Runtime,
  user: SessionUser,
  id: string,
): Promise<Contact> {
  const current = await requireContact(rt, id);
  await assertContactVisible(rt, user, current);
  if (!current.archivedAt) throw new HttpError(409, "not_archived", "Контакт не в архиве");
  const row = await rt.prisma.contact.update({
    where: { id },
    data: { archivedAt: null },
    include: organizationInclude,
  });
  return contactDto(rt, user, row);
}

/**
 * Удалить контакт навсегда. Запрещено, если на него ссылается хотя бы одна
 * заявка (как покупатель или реферер) — иначе осиротим/потеряем связи; для
 * таких используем архив. Также нельзя удалить компанию с привязанными
 * представителями.
 */
export async function deleteContact(rt: Runtime, id: string): Promise<void> {
  await requireContact(rt, id);
  const [asBuyer, asReferrer, representatives] = await Promise.all([
    rt.prisma.lead.count({ where: { contactId: id } }),
    rt.prisma.lead.count({ where: { referrerId: id } }),
    rt.prisma.contact.count({ where: { organizationId: id } }),
  ]);
  if (asBuyer + asReferrer > 0) {
    throw new HttpError(
      409,
      "contact_in_use",
      `На контакт ссылаются заявки (${asBuyer + asReferrer}). Используйте архив.`,
    );
  }
  if (representatives > 0) {
    throw new HttpError(
      409,
      "company_in_use",
      `Компанию представляют контрагенты (${representatives}). Сначала перепривяжите их.`,
    );
  }
  await rt.prisma.contact.delete({ where: { id } });
}

/**
 * Найти или создать контакт-клиента по телефону (для приёма заявки). Работает
 * в транзакции приёма. Существующему контакту имя НЕ перезаписываем (могло быть
 * отредактировано вручную). Возвращает id контакта.
 *
 * Если найденный клиент был в архиве — возвращаем его в работу (снимаем
 * `archivedAt`): новая заявка = активность, иначе контакт остался бы скрыт из
 * списков (для non-admin), имея свежую заявку.
 *
 * Дедуп держится на прикладном коде (findFirst→create), без уникального индекса
 * на `(isClient, phone)`: осознанно для single-instance VPS (там же живут in-memory
 * анти-спам и троттлинг из CLAUDE.md), где гонка двух заявок с одного нового
 * телефона в один момент пренебрежимо мала. При масштабировании на несколько
 * инстансов сюда понадобится частичный уникальный индекс.
 */
export async function findOrCreateClientByPhone(
  tx: Prisma.TransactionClient | PrismaClient,
  phone: string,
  name: string,
  createdById: string | null = null,
): Promise<string> {
  const existing = await tx.contact.findFirst({
    where: { isClient: true, phone },
    orderBy: { createdAt: "asc" },
    select: { id: true, archivedAt: true },
  });
  if (existing) {
    if (existing.archivedAt) {
      await tx.contact.update({ where: { id: existing.id }, data: { archivedAt: null } });
    }
    return existing.id;
  }
  const created = await tx.contact.create({
    data: { type: "individual", isClient: true, isPartner: false, fullName: name, phone, createdById },
    select: { id: true },
  });
  return created.id;
}

function requireClientPhone(isClient: boolean, phone: string | null): string | null {
  if (!isClient) return null;
  if (!phone || normalizeRuPhone(phone) === null) {
    throw new HttpError(422, "client_phone_required", "Укажите телефон клиента", {
      phone: "Укажите телефон клиента",
    });
  }
  return phone;
}

async function assertClientPhoneChangeAllowed(
  rt: Runtime,
  id: string,
  isClient: boolean,
  currentPhone: string | null,
  nextPhone: string | null,
): Promise<void> {
  if (!isClient || nextPhone === currentPhone) return;
  const linked = await rt.prisma.lead.count({ where: { contactId: id } });
  if (linked === 0) return;
  throw new HttpError(
    422,
    "client_phone_locked",
    "Телефон клиента с заявками нельзя менять — создайте или выберите другого клиента",
    { phone: "У клиента уже есть заявки, телефон менять нельзя" },
  );
}

async function assertNoDuplicateClientPhone(
  rt: Runtime,
  user: SessionUser,
  phone: string | null,
  exceptId?: string,
): Promise<void> {
  if (!phone) return;
  const existing = await rt.prisma.contact.findFirst({
    where: {
      isClient: true,
      phone,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, createdById: true },
  });
  if (!existing) return;
  if (user.role !== "admin" && !(await canAccessClientContact(rt, user, existing))) {
    throw new HttpError(404, "not_found", "Контакт не найден");
  }
  throw new HttpError(
    409,
    "duplicate_client_phone",
    "Клиент с таким телефоном уже есть — найдите его в контактах и выберите существующего",
    { phone: "Клиент с таким телефоном уже есть" },
  );
}

async function restoreDuplicateArchivedClient(
  rt: Runtime,
  user: SessionUser,
  input: UpsertContactInput,
  phone: string | null,
): Promise<Contact | null> {
  if (!input.isClient || !phone) return null;
  const existing = await rt.prisma.contact.findFirst({
    where: { isClient: true, phone, archivedAt: { not: null } },
    orderBy: { createdAt: "asc" },
    include: organizationInclude,
  });
  if (!existing?.archivedAt) return null;
  await assertContactVisible(rt, user, existing);
  await assertNoDuplicateClientPhone(rt, user, phone, existing.id);
  const row = await rt.prisma.contact.update({
    where: { id: existing.id },
    data: {
      fullName: input.fullName,
      note: input.note ?? null,
      ...passportData(existing.type, input),
      lastInteractionAt: input.lastInteractionAt ? new Date(input.lastInteractionAt) : null,
      archivedAt: null,
    },
    include: organizationInclude,
  });
  return contactDto(rt, user, row);
}

/**
 * Пустой/пробельный телефон → null. Валидный РФ-номер приводим к каноническому
 * `+7XXXXXXXXXX` (тот же ключ, что при приёме заявки, — чтобы вручную заведённый
 * клиент склеивался с клиентом из заявки по телефону); прочие форматы (напр.
 * зарубежный номер партнёра) сохраняем как есть (trim).
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (phone === undefined || phone === null) return null;
  const t = phone.trim();
  if (t.length === 0) return null;
  return normalizeRuPhone(t) ?? t;
}

/** Оптимистичная блокировка: версия совпала — ок, иначе 409 stale_update. */
function assertFresh(current: Date, expected: string | undefined): void {
  if (expected && current.toISOString() !== expected) {
    throw new HttpError(
      409,
      "stale_update",
      "Контакт изменён другим пользователем — обновите страницу",
    );
  }
}
