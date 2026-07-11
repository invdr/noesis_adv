import type {
  BookingReport,
  SessionUser,
  UpsertBookingReportInput,
} from "@noesis/contracts";
import { HttpError } from "../http/errors";
import { fileBytes } from "../http/multipart";
import type { Runtime } from "../runtime";
import { deleteAsset, storeUpload } from "../files/file-service";
import {
  bookingReportInclude,
  toBookingReportDto,
  type BookingReportRow,
} from "./booking-report-dto";

export async function listBookingReports(
  rt: Runtime,
  bookingId: string,
): Promise<BookingReport[]> {
  await requireBooking(rt, bookingId);
  const rows = await rt.prisma.bookingReport.findMany({
    where: { bookingId },
    include: bookingReportInclude,
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toBookingReportDto);
}

export async function createBookingReport(
  rt: Runtime,
  user: SessionUser,
  bookingId: string,
  input: UpsertBookingReportInput,
): Promise<BookingReport> {
  const booking = await requireReportableBooking(rt, bookingId);
  const period = assertDateInsideBooking(input.date, booking);
  await requireFreePeriod(rt, bookingId, period.year, period.month);
  try {
    const report = await rt.prisma.bookingReport.create({
      data: {
        bookingId,
        ...period,
        reportDate: dateOnlyToDate(input.date),
        note: input.note?.trim() || null,
        createdById: user.id,
      },
      include: bookingReportInclude,
    });
    return toBookingReportDto(report as BookingReportRow);
  } catch (err) {
    throw mapPeriodConflict(err);
  }
}

export async function updateBookingReport(
  rt: Runtime,
  bookingId: string,
  reportId: string,
  input: UpsertBookingReportInput,
): Promise<BookingReport> {
  const report = await requireReport(rt, bookingId, reportId);
  const booking = await requireReportableBooking(rt, bookingId);
  const period = assertDateInsideBooking(input.date, booking);
  if (report.year !== period.year || report.month !== period.month) {
    await requireFreePeriod(rt, bookingId, period.year, period.month);
  }
  try {
    const updated = await rt.prisma.bookingReport.update({
      where: { id: reportId },
      data: {
        ...period,
        reportDate: dateOnlyToDate(input.date),
        note: input.note?.trim() || null,
      },
      include: bookingReportInclude,
    });
    return toBookingReportDto(updated as BookingReportRow);
  } catch (err) {
    throw mapPeriodConflict(err);
  }
}

export async function deleteBookingReport(
  rt: Runtime,
  bookingId: string,
  reportId: string,
): Promise<void> {
  await requireReport(rt, bookingId, reportId);
  const photos = await rt.prisma.bookingReportPhoto.findMany({
    where: { reportId },
    select: { assetId: true },
  });
  await rt.prisma.bookingReport.delete({ where: { id: reportId } });
  for (const photo of photos) {
    await deleteAsset(rt, photo.assetId).catch((err) =>
      console.error(`[booking-report] could not remove file ${photo.assetId}:`, err),
    );
  }
}

export async function addBookingReportPhotos(
  rt: Runtime,
  user: SessionUser,
  bookingId: string,
  reportId: string,
  files: File[],
): Promise<BookingReport> {
  await requireReport(rt, bookingId, reportId);
  await requireReportableBooking(rt, bookingId);
  if (files.length === 0) {
    throw new HttpError(422, "missing_file", "Не переданы фотографии");
  }
  let position = await nextPosition(rt, reportId);
  for (const file of files) {
    const asset = await storeUpload(
      rt,
      { bytes: await fileBytes(file), originalName: file.name },
      { createdById: user.id, storageScope: "bookingReport" },
    );
    if (asset.kind !== "image") {
      await deleteAsset(rt, asset.id).catch(() => {});
      throw new HttpError(422, "expected_image", "В фотоотчёт можно загружать только изображения");
    }
    try {
      await rt.prisma.bookingReportPhoto.create({
        data: { reportId, assetId: asset.id, position: position++ },
      });
    } catch (err) {
      await deleteAsset(rt, asset.id).catch(() => {});
      throw err;
    }
  }
  const report = await rt.prisma.bookingReport.findUnique({
    where: { id: reportId },
    include: bookingReportInclude,
  });
  if (!report) throw new HttpError(404, "not_found", "Фотоотчёт не найден");
  return toBookingReportDto(report as BookingReportRow);
}

export async function deleteBookingReportPhoto(
  rt: Runtime,
  bookingId: string,
  reportId: string,
  photoId: string,
): Promise<void> {
  await requireReport(rt, bookingId, reportId);
  const photo = await rt.prisma.bookingReportPhoto.findFirst({
    where: { id: photoId, reportId },
  });
  if (!photo) throw new HttpError(404, "not_found", "Фотография не найдена");
  await rt.prisma.bookingReportPhoto.delete({ where: { id: photoId } });
  await deleteAsset(rt, photo.assetId).catch((err) =>
    console.error(`[booking-report] could not remove file ${photo.assetId}:`, err),
  );
}

export async function getBookingReportPhotoAsset(
  rt: Runtime,
  bookingId: string,
  reportId: string,
  photoId: string,
) {
  await requireReport(rt, bookingId, reportId);
  const photo = await rt.prisma.bookingReportPhoto.findFirst({
    where: { id: photoId, reportId },
    include: { asset: true },
  });
  if (!photo) throw new HttpError(404, "not_found", "Фотография не найдена");
  return photo.asset;
}

// --- internal ---

async function requireBooking(rt: Runtime, id: string) {
  const booking = await rt.prisma.booking.findUnique({
    where: { id },
    select: { id: true, status: true, startDate: true, endDate: true },
  });
  if (!booking) throw new HttpError(404, "not_found", "Бронь не найдена");
  return booking;
}

async function requireReportableBooking(rt: Runtime, id: string) {
  const booking = await requireBooking(rt, id);
  if (booking.status === "cancelled") {
    throw new HttpError(422, "cancelled_booking", "Нельзя добавить фотоотчёт к отменённой брони");
  }
  return booking;
}

async function requireReport(rt: Runtime, bookingId: string, reportId: string) {
  const report = await rt.prisma.bookingReport.findFirst({
    where: { id: reportId, bookingId },
    select: { id: true, year: true, month: true },
  });
  if (!report) throw new HttpError(404, "not_found", "Фотоотчёт не найден");
  return report;
}

function assertDateInsideBooking(
  date: string,
  booking: { startDate: Date; endDate: Date },
): { year: number; month: number } {
  const reportDate = dateOnlyToDate(date);
  if (reportDate < booking.startDate || reportDate >= booking.endDate) {
    throw new HttpError(
      422,
      "report_date_outside_booking",
      "Дата фотоотчёта должна попадать в период брони",
    );
  }
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

async function requireFreePeriod(
  rt: Runtime,
  bookingId: string,
  year: number,
  month: number,
): Promise<void> {
  const exists = await rt.prisma.bookingReport.count({ where: { bookingId, year, month } });
  if (exists) {
    throw new HttpError(
      409,
      "report_month_exists",
      "Фотоотчёт за этот месяц уже есть — добавьте фотографии в него",
    );
  }
}

async function nextPosition(rt: Runtime, reportId: string): Promise<number> {
  const last = await rt.prisma.bookingReportPhoto.findFirst({
    where: { reportId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

function dateOnlyToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function mapPeriodConflict(err: unknown): unknown {
  if (err && typeof err === "object" && (err as { code?: unknown }).code === "P2002") {
    return new HttpError(
      409,
      "report_month_exists",
      "Фотоотчёт за этот месяц уже есть — добавьте фотографии в него",
    );
  }
  return err;
}
