import type {
  Contact,
  ContactDetail,
  ContactLeadRef,
  ContactKind,
  ListContactsQuery,
  SessionUser,
  UpsertContactInput,
} from "@noesis/contracts";
import { normalizeRuPhone } from "@noesis/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import { visibilityWhere } from "../leads/lead-visibility";
import { canAccessClientContact, clientContactAccessWhere } from "./client-access";
import {
  toContactDto,
  type ContactAggregates,
  type ContactRow,
  type LatestLeadRow,
} from "./contact-dto";

const PARTNER_KINDS: ContactKind[] = ["realtor", "agency"];
const agencyInclude = { agency: { select: { fullName: true } } } as const;
const stageSelect = {
  select: { id: true, name: true, kind: true, funnelId: true },
} as const;

function nullableText(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value || null;
}

function passportData(kind: ContactKind, input: UpsertContactInput) {
  if (kind !== "client") {
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

/**
 * Список контактов: фильтр по типу/поиску/архиву + видимость. Партнёры
 * (realtor/agency) видны всем сотрудникам; клиенты — менеджеру только если у
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
  if (query.kind) filters.push({ kind: query.kind });
  if (!(query.includeArchived && user.role === "admin")) {
    filters.push({ archivedAt: null });
  }
  if (query.search) {
    const term = query.search;
    const digits = normalizePhoneSearch(term);
    const or: Prisma.ContactWhereInput[] = [
      { fullName: { contains: term, mode: "insensitive" } },
      { companyName: { contains: term, mode: "insensitive" } },
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
        { kind: { in: PARTNER_KINDS } },
        { kind: "client", ...clientContactAccessWhere(user) },
      ],
    });
  }

  const rows = (await rt.prisma.contact.findMany({
    where: { AND: filters },
    include: { ...agencyInclude, _count: { select: { referredLeads: true } } },
    orderBy: [{ createdAt: "desc" }],
  })) as (ContactRow & { _count: { referredLeads: number } })[];

  // Агрегаты по заявкам-покупателям одним запросом (с учётом видимости).
  const clientIds = rows.filter((r) => r.kind === "client").map((r) => r.id);
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
    row.kind === "client"
      ? rt.prisma.lead.findMany({
          where: { AND: [{ contactId: id }, visibilityWhere(user)] },
          select: contactLeadSelect,
          orderBy: { createdAt: "desc" },
          take: CONTACT_LEADS_LIMIT,
        })
      : Promise.resolve([]),
    row.kind !== "client"
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

/** Загрузить контакт с агентством или бросить 404. */
async function requireContact(rt: Runtime, id: string): Promise<ContactRow> {
  const row = await rt.prisma.contact.findUnique({
    where: { id },
    include: agencyInclude,
  });
  if (!row) throw new HttpError(404, "not_found", "Контакт не найден");
  return row;
}

/**
 * Guard видимости для операций записи над контактом-клиентом: та же граница,
 * что в `listContacts`. Партнёры (realtor/agency) видны всем сотрудникам; клиент
 * доступен менеджеру только через видимую ему заявку (свою/неназначенную), admin
 * — всегда. Невидимый клиент → 404 (как будто его нет), чтобы правка/архив по id
 * не читали/меняли ПДн чужого клиента и не палили его существование.
 */
async function assertContactVisible(
  rt: Runtime,
  user: SessionUser,
  contact: ContactRow,
): Promise<void> {
  if (user.role === "admin" || contact.kind !== "client") return;
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
    row.kind === "client"
      ? rt.prisma.lead.count({
          where: { AND: [{ contactId: row.id }, visibilityWhere(user)] },
        })
      : Promise.resolve(0),
    rt.prisma.lead.count({ where: { referrerId: row.id } }),
    row.kind === "client"
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

/**
 * Инварианты типа: у риелтора `agencyId` (если задан) ссылается на живое
 * агентство; у агентства/клиента agencyId быть не может; запрет самоссылки.
 * Нормализует agencyId к значению для записи (undefined = не трогать в апдейте).
 *
 * Уже привязанное агентство (возможно, ставшее архивным) сохранять можно —
 * иначе нельзя было бы отредактировать риелтора после архивации его агентства.
 * Запрещаем лишь НАЗНАЧЕНИЕ нового архивного/несуществующего агентства
 * (тот же приём, что и с типом контакта в `updateNextContact`).
 */
async function resolveAgencyId(
  rt: Runtime,
  kind: ContactKind,
  agencyId: string | null | undefined,
  selfId: string | null,
  currentAgencyId: string | null = null,
): Promise<string | null | undefined> {
  if (agencyId === undefined) return kind === "realtor" ? undefined : null;
  if (agencyId === null) return null;
  if (kind !== "realtor") {
    throw new HttpError(422, "agency_not_allowed", "Агентство можно указать только у риелтора");
  }
  if (selfId && agencyId === selfId) {
    throw new HttpError(422, "agency_self", "Контакт не может быть своим агентством");
  }
  const agency = await rt.prisma.contact.findUnique({ where: { id: agencyId } });
  const unchanged = agencyId === currentAgencyId;
  if (!agency || agency.kind !== "agency" || (agency.archivedAt && !unchanged)) {
    throw new HttpError(422, "invalid_agency", "Агентство не найдено");
  }
  return agencyId;
}

/**
 * Смена типа контакта не должна осиротить связи и обойти инварианты:
 * - агентство с привязанными риелторами не может перестать быть агентством
 *   (иначе их `agencyId` укажет на не-агентство и роллап аналитики рассыплется);
 * - клиент с заявками-покупателя не может стать партнёром (иначе `Lead.contactId`
 *   укажет на не-клиента — buyer-агрегаты его потеряют, а дедуп заведёт дубль);
 * - клиента вообще нельзя ПОЛУЧИТЬ сменой типа: клиенты заводятся только
 *   автоматически при приёме заявки (дедуп по телефону), поэтому конверсия
 *   партнёр→клиент запрещена безусловно — зеркало `createContact`
 *   (`client_not_creatable`); иначе можно завести второго клиента на тот же
 *   телефон в обход дедупа и оставить сироту.
 * Иначе — 409/422, как в `deleteContact`/`createContact`; сначала перепривязать связи.
 */
async function assertKindChangeAllowed(
  rt: Runtime,
  id: string,
  from: ContactKind,
  to: ContactKind,
): Promise<void> {
  if (from === to) return;
  if (from === "agency") {
    const realtors = await rt.prisma.contact.count({ where: { agencyId: id } });
    if (realtors > 0) {
      throw new HttpError(
        409,
        "agency_in_use",
        `К агентству привязаны риелторы (${realtors}). Сначала перепривяжите их.`,
      );
    }
  }
  if (from === "client") {
    // from!==to (короткое замыкание выше) ⇒ уходим из client в партнёра.
    const asBuyer = await rt.prisma.lead.count({ where: { contactId: id } });
    if (asBuyer > 0) {
      throw new HttpError(
        409,
        "contact_in_use",
        `На контакт ссылаются заявки-покупателя (${asBuyer}). Сначала перепривяжите их.`,
      );
    }
  }
  if (to === "client") {
    // from!==to (короткое замыкание выше) ⇒ конверсия партнёр→клиент. Запрещена
    // безусловно: клиента заводят только при приёме заявки (иначе дубль в обход
    // дедупа + сирота). Это строже прежней проверки `referrerId` и поглощает её.
    throw new HttpError(
      422,
      "client_not_creatable",
      "Клиента нельзя получить сменой типа — клиенты заводятся при приёме заявки",
    );
  }
}

/** Создать контакт. Для клиентов телефон обязателен и проверяется на дубли. */
export async function createContact(
  rt: Runtime,
  user: SessionUser,
  input: UpsertContactInput,
): Promise<Contact> {
  const phone = normalizePhone(input.phone);
  const clientPhone = requireClientPhone(input.kind, phone);
  const restored = await restoreDuplicateArchivedClient(rt, user, input, clientPhone);
  if (restored) return restored;
  await assertNoDuplicateClientPhone(rt, user, clientPhone);
  const agencyId = await resolveAgencyId(rt, input.kind, input.agencyId, null);
  const row = await rt.prisma.contact.create({
    data: {
      kind: input.kind,
      fullName: input.fullName,
      phone,
      companyName: input.kind === "agency" ? input.companyName ?? null : null,
      agencyId: agencyId ?? null,
      createdById: user.id,
      note: input.note ?? null,
      ...passportData(input.kind, input),
      lastInteractionAt: input.lastInteractionAt ? new Date(input.lastInteractionAt) : null,
    },
    include: agencyInclude,
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
  await assertKindChangeAllowed(rt, id, current.kind, input.kind);
  const agencyId = await resolveAgencyId(rt, input.kind, input.agencyId, id, current.agencyId);
  const phone = normalizePhone(input.phone);
  const clientPhone = requireClientPhone(input.kind, phone);
  await assertClientPhoneChangeAllowed(rt, id, current.kind, current.phone, phone);
  await assertNoDuplicateClientPhone(rt, user, clientPhone, id);
  const row = await rt.prisma.contact.update({
    where: { id },
    data: {
      kind: input.kind,
      fullName: input.fullName,
      phone,
      companyName: input.kind === "agency" ? input.companyName ?? null : null,
      agencyId,
      note: input.note ?? null,
      ...passportData(input.kind, input),
      lastInteractionAt:
        input.lastInteractionAt === undefined
          ? undefined
          : input.lastInteractionAt
            ? new Date(input.lastInteractionAt)
            : null,
    },
    include: agencyInclude,
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
    include: agencyInclude,
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
    include: agencyInclude,
  });
  return contactDto(rt, user, row);
}

/**
 * Удалить контакт навсегда. Запрещено, если на него ссылается хотя бы одна
 * заявка (как покупатель или реферер) — иначе осиротим/потеряем связи; для
 * таких используем архив. Также нельзя удалить агентство с привязанными
 * риелторами.
 */
export async function deleteContact(rt: Runtime, id: string): Promise<void> {
  await requireContact(rt, id);
  const [asBuyer, asReferrer, realtors] = await Promise.all([
    rt.prisma.lead.count({ where: { contactId: id } }),
    rt.prisma.lead.count({ where: { referrerId: id } }),
    rt.prisma.contact.count({ where: { agencyId: id } }),
  ]);
  if (asBuyer + asReferrer > 0) {
    throw new HttpError(
      409,
      "contact_in_use",
      `На контакт ссылаются заявки (${asBuyer + asReferrer}). Используйте архив.`,
    );
  }
  if (realtors > 0) {
    throw new HttpError(
      409,
      "agency_in_use",
      `К агентству привязаны риелторы (${realtors}). Сначала перепривяжите их.`,
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
 * на `(kind, phone)`: осознанно для single-instance VPS (там же живут in-memory
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
    where: { kind: "client", phone },
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
    data: { kind: "client", fullName: name, phone, createdById },
    select: { id: true },
  });
  return created.id;
}

function requireClientPhone(kind: ContactKind, phone: string | null): string | null {
  if (kind !== "client") return null;
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
  kind: ContactKind,
  currentPhone: string | null,
  nextPhone: string | null,
): Promise<void> {
  if (kind !== "client" || nextPhone === currentPhone) return;
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
      kind: "client",
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
  if (input.kind !== "client" || !phone) return null;
  const existing = await rt.prisma.contact.findFirst({
    where: { kind: "client", phone, archivedAt: { not: null } },
    orderBy: { createdAt: "asc" },
    include: agencyInclude,
  });
  if (!existing?.archivedAt) return null;
  await assertContactVisible(rt, user, existing);
  await assertNoDuplicateClientPhone(rt, user, phone, existing.id);
  const row = await rt.prisma.contact.update({
    where: { id: existing.id },
    data: {
      fullName: input.fullName,
      note: input.note ?? null,
      ...passportData(input.kind, input),
      lastInteractionAt: input.lastInteractionAt ? new Date(input.lastInteractionAt) : null,
      archivedAt: null,
    },
    include: agencyInclude,
  });
  return contactDto(rt, user, row);
}

function normalizePhoneSearch(term: string): string | null {
  const digits = term.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return digits.replace(/^8/, "7");
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
