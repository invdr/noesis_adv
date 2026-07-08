import type { SessionUser } from "@gsk-tower/contracts";
import type { Prisma } from "@prisma/client";
import type { Runtime } from "../runtime";
import { visibilityWhere } from "../leads/lead-visibility";

type ClientAccessContact = {
  id: string;
  createdById: string | null;
};

export function clientContactAccessWhere(user: SessionUser): Prisma.ContactWhereInput {
  if (user.role === "admin") return {};
  return {
    OR: [
      { createdById: user.id, leads: { none: {} } },
      { leads: { some: visibilityWhere(user) } },
    ],
  };
}

export async function canAccessClientContact(
  rt: Runtime,
  user: SessionUser,
  contact: ClientAccessContact,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const visibleLeadCount = await rt.prisma.lead.count({
    where: { AND: [{ contactId: contact.id }, visibilityWhere(user)] },
  });
  if (visibleLeadCount > 0) return true;
  if (contact.createdById !== user.id) return false;
  const linkedLeadCount = await rt.prisma.lead.count({ where: { contactId: contact.id } });
  return linkedLeadCount === 0;
}
