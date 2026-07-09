import type {
  BookingBrand,
  BookingServiceReason,
  ReorderBookingBrandsInput,
  ReorderBookingServiceReasonsInput,
  UpsertBookingBrandInput,
  UpsertBookingServiceReasonInput,
} from "@noesis/contracts";
import type { Runtime } from "../runtime";
import { HttpError } from "../http/errors";
import {
  toBookingBrandDto,
  toBookingServiceReasonDto,
} from "./booking-dto";

export async function listBookingBrands(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<BookingBrand[]> {
  const rows = await rt.prisma.bookingBrand.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toBookingBrandDto);
}

export async function createBookingBrand(
  rt: Runtime,
  input: UpsertBookingBrandInput,
): Promise<BookingBrand> {
  const last = await rt.prisma.bookingBrand.findFirst({ orderBy: { order: "desc" } });
  const row = await rt.prisma.bookingBrand.create({
    data: { name: input.name, order: (last?.order ?? 0) + 1 },
  });
  return toBookingBrandDto(row);
}

export async function updateBookingBrand(
  rt: Runtime,
  id: string,
  input: UpsertBookingBrandInput,
): Promise<BookingBrand> {
  await requireBookingBrand(rt, id);
  const row = await rt.prisma.bookingBrand.update({
    where: { id },
    data: { name: input.name },
  });
  return toBookingBrandDto(row);
}

export async function reorderBookingBrands(
  rt: Runtime,
  input: ReorderBookingBrandsInput,
): Promise<BookingBrand[]> {
  const live = await rt.prisma.bookingBrand.findMany({ where: { archivedAt: null } });
  const liveIds = new Set(live.map((b) => b.id));
  if (input.ids.length !== live.length || !input.ids.every((id) => liveIds.has(id))) {
    throw new HttpError(
      422,
      "reorder_mismatch",
      "Список должен содержать все живые бренды ровно по одному разу",
    );
  }
  await rt.prisma.$transaction(
    input.ids.map((id, i) =>
      rt.prisma.bookingBrand.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );
  return listBookingBrands(rt);
}

export async function archiveBookingBrand(rt: Runtime, id: string): Promise<BookingBrand> {
  await requireBookingBrand(rt, id);
  const row = await rt.prisma.bookingBrand.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toBookingBrandDto(row);
}

export async function restoreBookingBrand(rt: Runtime, id: string): Promise<BookingBrand> {
  await requireBookingBrand(rt, id);
  const last = await rt.prisma.bookingBrand.findFirst({ orderBy: { order: "desc" } });
  const row = await rt.prisma.bookingBrand.update({
    where: { id },
    data: { archivedAt: null, order: (last?.order ?? 0) + 1 },
  });
  return toBookingBrandDto(row);
}

export async function deleteBookingBrand(rt: Runtime, id: string): Promise<void> {
  await requireBookingBrand(rt, id);
  const used = await rt.prisma.booking.count({ where: { brandId: id } });
  if (used > 0) {
    throw new HttpError(
      409,
      "brand_in_use",
      `Бренд используют брони (${used}). Используйте архив.`,
    );
  }
  await rt.prisma.bookingBrand.delete({ where: { id } });
}

export async function listBookingServiceReasons(
  rt: Runtime,
  opts: { includeArchived?: boolean } = {},
): Promise<BookingServiceReason[]> {
  const rows = await rt.prisma.bookingServiceReason.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toBookingServiceReasonDto);
}

export async function createBookingServiceReason(
  rt: Runtime,
  input: UpsertBookingServiceReasonInput,
): Promise<BookingServiceReason> {
  const last = await rt.prisma.bookingServiceReason.findFirst({
    orderBy: { order: "desc" },
  });
  const row = await rt.prisma.bookingServiceReason.create({
    data: { name: input.name, order: (last?.order ?? 0) + 1 },
  });
  return toBookingServiceReasonDto(row);
}

export async function updateBookingServiceReason(
  rt: Runtime,
  id: string,
  input: UpsertBookingServiceReasonInput,
): Promise<BookingServiceReason> {
  await requireBookingServiceReason(rt, id);
  const row = await rt.prisma.bookingServiceReason.update({
    where: { id },
    data: { name: input.name },
  });
  return toBookingServiceReasonDto(row);
}

export async function reorderBookingServiceReasons(
  rt: Runtime,
  input: ReorderBookingServiceReasonsInput,
): Promise<BookingServiceReason[]> {
  const live = await rt.prisma.bookingServiceReason.findMany({
    where: { archivedAt: null },
  });
  const liveIds = new Set(live.map((r) => r.id));
  if (input.ids.length !== live.length || !input.ids.every((id) => liveIds.has(id))) {
    throw new HttpError(
      422,
      "reorder_mismatch",
      "Список должен содержать все живые причины ровно по одному разу",
    );
  }
  await rt.prisma.$transaction(
    input.ids.map((id, i) =>
      rt.prisma.bookingServiceReason.update({
        where: { id },
        data: { order: i + 1 },
      }),
    ),
  );
  return listBookingServiceReasons(rt);
}

export async function archiveBookingServiceReason(
  rt: Runtime,
  id: string,
): Promise<BookingServiceReason> {
  await requireBookingServiceReason(rt, id);
  const row = await rt.prisma.bookingServiceReason.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toBookingServiceReasonDto(row);
}

export async function restoreBookingServiceReason(
  rt: Runtime,
  id: string,
): Promise<BookingServiceReason> {
  await requireBookingServiceReason(rt, id);
  const last = await rt.prisma.bookingServiceReason.findFirst({
    orderBy: { order: "desc" },
  });
  const row = await rt.prisma.bookingServiceReason.update({
    where: { id },
    data: { archivedAt: null, order: (last?.order ?? 0) + 1 },
  });
  return toBookingServiceReasonDto(row);
}

export async function deleteBookingServiceReason(
  rt: Runtime,
  id: string,
): Promise<void> {
  await requireBookingServiceReason(rt, id);
  const used = await rt.prisma.booking.count({ where: { serviceReasonId: id } });
  if (used > 0) {
    throw new HttpError(
      409,
      "service_reason_in_use",
      `Причину используют брони (${used}). Используйте архив.`,
    );
  }
  await rt.prisma.bookingServiceReason.delete({ where: { id } });
}

async function requireBookingBrand(rt: Runtime, id: string) {
  const row = await rt.prisma.bookingBrand.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "not_found", "Бренд не найден");
  return row;
}

async function requireBookingServiceReason(rt: Runtime, id: string) {
  const row = await rt.prisma.bookingServiceReason.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "not_found", "Причина служебной брони не найдена");
  return row;
}
