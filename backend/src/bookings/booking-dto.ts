import type {
  Booking as PrismaBooking,
  BookingBrand as PrismaBookingBrand,
  BookingServiceReason as PrismaBookingServiceReason,
  Construction as PrismaConstruction,
  ConstructionSide as PrismaConstructionSide,
  Contact as PrismaContact,
  Lead as PrismaLead,
  User as PrismaUser,
} from "@prisma/client";
import type {
  Booking,
  BookingBrand,
  BookingServiceReason,
  BookingKind,
  BookingStatus,
  ConstructionSide,
} from "@noesis/contracts";
import { pricePerMonthLabel } from "@noesis/contracts";

export type BookingRow = PrismaBooking & {
  construction: PrismaConstruction;
  constructionSide: PrismaConstructionSide;
  client: PrismaContact | null;
  serviceReason: PrismaBookingServiceReason | null;
  brand: PrismaBookingBrand | null;
  lead: PrismaLead | null;
  manager: PrismaUser | null;
  createdBy: PrismaUser | null;
};

export const bookingInclude = {
  construction: true,
  constructionSide: true,
  client: true,
  serviceReason: true,
  brand: true,
  lead: true,
  manager: true,
  createdBy: true,
};

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toBookingBrandDto(row: PrismaBookingBrand): BookingBrand {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    isArchived: row.archivedAt !== null,
  };
}

export function toBookingServiceReasonDto(
  row: PrismaBookingServiceReason,
): BookingServiceReason {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    isArchived: row.archivedAt !== null,
  };
}

function userSummary(user: PrismaUser | null) {
  return user
    ? { id: user.id, email: user.email, name: user.name }
    : null;
}

function contactSummary(contact: PrismaContact | null) {
  return contact
    ? {
        id: contact.id,
        fullName: contact.fullName,
        phone: contact.phone,
        companyName: contact.companyName,
      }
    : null;
}

function leadSummary(lead: PrismaLead | null) {
  return lead ? { id: lead.id, name: lead.name, phone: lead.phone } : null;
}

export function toBookingDto(row: BookingRow): Booking {
  return {
    id: row.id,
    kind: row.kind as BookingKind,
    status: row.status as BookingStatus,
    construction: {
      id: row.construction.id,
      name: row.construction.name,
      code: row.construction.code,
      address: row.construction.address,
      sideCount:
        row.construction.sideCount === 3
          ? 3
          : row.construction.sideCount === 2
            ? 2
            : 1,
      pricePerMonth: row.construction.pricePerMonth,
    },
    side: {
      id: row.constructionSide.id,
      code: row.constructionSide.code as ConstructionSide,
      description: row.constructionSide.description,
      pricePerMonth: row.constructionSide.pricePerMonth,
      effectivePricePerMonth:
        row.constructionSide.pricePerMonth ?? row.construction.pricePerMonth,
      priceLabel: pricePerMonthLabel(
        row.constructionSide.pricePerMonth ?? row.construction.pricePerMonth,
      ),
      trafficPerDay: row.constructionSide.trafficPerDay,
      grp: row.constructionSide.grp,
    },
    client: contactSummary(row.client),
    serviceReason: row.serviceReason
      ? toBookingServiceReasonDto(row.serviceReason)
      : null,
    brand: row.brand ? toBookingBrandDto(row.brand) : null,
    campaignNote: row.campaignNote,
    lead: leadSummary(row.lead),
    startDate: toDateOnly(row.startDate),
    endDate: toDateOnly(row.endDate),
    durationMonths: row.durationMonths,
    basePricePerMonth: row.basePricePerMonth,
    totalPrice: row.totalPrice,
    priceNote: row.priceNote,
    reminderAt: row.reminderAt ? toDateOnly(row.reminderAt) : null,
    manager: userSummary(row.manager),
    createdBy: userSummary(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
