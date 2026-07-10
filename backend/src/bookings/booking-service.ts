import { Prisma } from "@prisma/client";
import {
  addBookingMonths,
  bookingDefaultTotal,
  defaultBookingReminder,
  paginatedSchema,
  bookingSchema,
  type Booking,
  type ListBookingsQuery,
  type SessionUser,
  type UpsertBookingInput,
} from "@noesis/contracts";
import { z } from "zod";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import {
  bookingInclude,
  toBookingDto,
  toDateOnly,
  type BookingRow,
} from "./booking-dto";
import { previousDateOnly } from "./booking-periods";

const paginatedBookings = paginatedSchema(bookingSchema);
export type PaginatedBookings = z.infer<typeof paginatedBookings>;

export async function listBookings(
  rt: Runtime,
  query: ListBookingsQuery,
): Promise<PaginatedBookings> {
  const where: Prisma.BookingWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.kind) where.kind = query.kind;
  if (query.constructionId) where.constructionId = query.constructionId;
  if (query.constructionSideId) where.constructionSideId = query.constructionSideId;
  if (query.from) where.endDate = { gt: dateOnlyToDate(query.from) };
  if (query.to) where.startDate = { lt: dateOnlyToDate(query.to) };
  if (query.search) {
    where.OR = [
      { campaignNote: { contains: query.search, mode: "insensitive" } },
      { construction: { name: { contains: query.search, mode: "insensitive" } } },
      { construction: { code: { contains: query.search, mode: "insensitive" } } },
      { client: { fullName: { contains: query.search, mode: "insensitive" } } },
      { brand: { name: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await rt.prisma.$transaction([
    rt.prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    rt.prisma.booking.count({ where }),
  ]);

  return {
    items: rows.map((b) => toBookingDto(b)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getBooking(rt: Runtime, id: string): Promise<Booking> {
  const row = await rt.prisma.booking.findUnique({
    where: { id },
    include: bookingInclude,
  });
  if (!row) throw new HttpError(404, "not_found", "Бронь не найдена");
  return toBookingDto(row);
}

export function createBooking(
  rt: Runtime,
  user: SessionUser,
  input: UpsertBookingInput,
): Promise<Booking> {
  return saveBooking(rt, user, input, null);
}

export function updateBooking(
  rt: Runtime,
  user: SessionUser,
  id: string,
  input: UpsertBookingInput,
): Promise<Booking> {
  return saveBooking(rt, user, input, id);
}

export async function cancelBooking(
  rt: Runtime,
  user: SessionUser,
  id: string,
): Promise<Booking> {
  const current = await rt.prisma.booking.findUnique({
    where: { id },
    include: bookingInclude,
  });
  if (!current) throw new HttpError(404, "not_found", "Бронь не найдена");
  const row = await rt.prisma.booking.update({
    where: { id },
    data: { status: "cancelled", managerId: current.managerId ?? user.id },
    include: bookingInclude,
  });
  return toBookingDto(row);
}

async function saveBooking(
  rt: Runtime,
  user: SessionUser,
  input: UpsertBookingInput,
  existingId: string | null,
): Promise<Booking> {
  try {
    const row = await rt.prisma.$transaction(
      async (tx) => {
        const current = existingId
          ? await tx.booking.findUnique({
              where: { id: existingId },
              include: bookingInclude,
            })
          : null;
        if (existingId && !current) {
          throw new HttpError(404, "not_found", "Бронь не найдена");
        }

        const construction = await tx.construction.findUnique({
          where: { id: input.constructionId },
          include: { sides: { orderBy: { code: "asc" } } },
        });
        if (!construction || construction.archivedAt) {
          throw new HttpError(422, "invalid_construction", "Конструкция не найдена или в архиве");
        }

        const constructionSide = resolveConstructionSide(construction, input);
        const startDate = dateOnlyToDate(input.startDate);
        const endDateOnly = addBookingMonths(input.startDate, input.durationMonths);
        const endDate = dateOnlyToDate(endDateOnly);
        const reminderDate = normalizeReminder(input, current, endDateOnly);

        await validateLinks(tx, input);
        await ensureNoOverlap(tx, {
          bookingId: existingId,
          constructionSideId: constructionSide.id,
          startDate,
          endDate,
          status: input.status,
        });

        const catalogPricePerMonth = constructionSide.pricePerMonth ?? construction.pricePerMonth;
        const basePricePerMonth =
          input.basePricePerMonth !== undefined
            ? input.basePricePerMonth
            : current
              ? current.basePricePerMonth
              : catalogPricePerMonth;
        const totalPrice =
          input.kind === "service"
            ? null
            : input.totalPrice !== undefined
              ? input.totalPrice
              : current
                ? current.totalPrice
                : bookingDefaultTotal(basePricePerMonth, input.durationMonths);
        const managerId =
          input.managerId !== undefined ? input.managerId : (current?.managerId ?? user.id);

        const data = {
          kind: input.kind,
          status: input.status,
          constructionId: construction.id,
          constructionSideId: constructionSide.id,
          clientId: input.kind === "commercial" ? (input.clientId ?? null) : null,
          serviceReasonId:
            input.kind === "service" ? (input.serviceReasonId ?? null) : null,
          brandId: input.brandId ?? null,
          campaignNote: input.campaignNote ?? null,
          leadId: input.leadId ?? null,
          startDate,
          endDate,
          durationMonths: input.durationMonths,
          basePricePerMonth,
          totalPrice,
          priceNote: input.priceNote ?? null,
          reminderAt: reminderDate,
          managerId,
        };

        return current
          ? tx.booking.update({
              where: { id: current.id },
              data,
              include: bookingInclude,
            })
          : tx.booking.create({
              data: { ...data, createdById: user.id },
              include: bookingInclude,
            });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return toBookingDto(row as BookingRow);
  } catch (err) {
    if (isSerializationFailure(err)) {
      throw new HttpError(
        409,
        "booking_conflict",
        "Период уже заняли параллельной бронью, обновите сетку",
      );
    }
    throw err;
  }
}

function dateOnlyToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function normalizeReminder(
  input: UpsertBookingInput,
  current: BookingRow | null,
  endDate: string,
): Date | null {
  if (input.reminderAt !== undefined) {
    return input.reminderAt ? dateOnlyToDate(input.reminderAt) : null;
  }
  if (current?.reminderAt) return dateOnlyToDate(toDateOnly(current.reminderAt));
  return dateOnlyToDate(defaultBookingReminder(endDate));
}

type ConstructionSideForBooking = {
  id: string;
  constructionId: string;
  code: string;
  pricePerMonth: number | null;
};

function resolveConstructionSide(
  construction: {
    id: string;
    sideCount: number;
    sides: ConstructionSideForBooking[];
  },
  input: UpsertBookingInput,
): ConstructionSideForBooking {
  const activeCodes = ["A", "B", "C"].slice(0, construction.sideCount);
  const invalidSide = (): never => {
    const message =
      construction.sideCount === 1
        ? "У односторонней конструкции используется сторона A"
        : "Выберите сторону конструкции";
    throw new HttpError(422, "invalid_side", message, {
      constructionSideId: message,
      side: message,
    });
  };

  if (input.constructionSideId) {
    const side = construction.sides.find((s) => s.id === input.constructionSideId);
    if (!side || !activeCodes.includes(side.code)) return invalidSide();
    if (input.side && input.side !== side.code) return invalidSide();
    return side;
  }

  if (construction.sideCount === 1) {
    if (input.side && input.side !== "A") return invalidSide();
    const sideA = construction.sides.find((side) => side.code === "A");
    if (!sideA) {
      throw new HttpError(422, "invalid_side", "У конструкции не заведена сторона A", {
        constructionSideId: "У конструкции не заведена сторона A",
      });
    }
    return sideA;
  }

  const side = input.side ? construction.sides.find((s) => s.code === input.side) : null;
  if (!side || !activeCodes.includes(side.code)) {
    return invalidSide();
  }
  return side;
}

async function validateLinks(
  tx: Prisma.TransactionClient,
  input: UpsertBookingInput,
): Promise<void> {
  if (input.kind === "commercial") {
    const client = await tx.contact.findFirst({
      where: { id: input.clientId ?? "", kind: "client", archivedAt: null },
    });
    if (!client) throw new HttpError(422, "invalid_client", "Клиент не найден");
  }

  if (input.kind === "service") {
    const reason = await tx.bookingServiceReason.findFirst({
      where: { id: input.serviceReasonId ?? "", archivedAt: null },
    });
    if (!reason) {
      throw new HttpError(422, "invalid_service_reason", "Причина служебной брони не найдена");
    }
  }

  if (input.brandId) {
    const brand = await tx.bookingBrand.findFirst({
      where: { id: input.brandId, archivedAt: null },
    });
    if (!brand) throw new HttpError(422, "invalid_brand", "Бренд не найден");
  }

  if (input.leadId) {
    const lead = await tx.lead.count({ where: { id: input.leadId } });
    if (!lead) throw new HttpError(422, "invalid_lead", "Заявка не найдена");
  }

  if (input.managerId) {
    const manager = await tx.user.count({
      where: { id: input.managerId, isActive: true },
    });
    if (!manager) throw new HttpError(422, "invalid_manager", "Ответственный не найден");
  }
}

async function ensureNoOverlap(
  tx: Prisma.TransactionClient,
  args: {
    bookingId: string | null;
    constructionSideId: string;
    startDate: Date;
    endDate: Date;
    status: string;
  },
): Promise<void> {
  if (args.status === "cancelled") return;
  const conflict = await tx.booking.findFirst({
    where: {
      ...(args.bookingId ? { id: { not: args.bookingId } } : {}),
      constructionSideId: args.constructionSideId,
      status: { not: "cancelled" },
      startDate: { lt: args.endDate },
      endDate: { gt: args.startDate },
    },
    include: { construction: true, client: true, brand: true },
  });
  if (!conflict) return;

  const label =
    conflict.client?.fullName ??
    conflict.brand?.name ??
    conflict.construction.name;
  throw new HttpError(
    409,
    "booking_overlap",
    `Период пересекается с бронью «${label}» (${toDateOnly(conflict.startDate)}–${previousDateOnly(conflict.endDate)})`,
  );
}

function isSerializationFailure(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2034"
  );
}
