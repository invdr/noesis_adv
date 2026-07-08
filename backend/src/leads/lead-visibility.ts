import type { SessionUser } from "@noesis/contracts";
import type { Prisma } from "@prisma/client";

/**
 * Lead visibility for managers: assigned to them or still in the shared queue.
 * Admins see all leads. Apply this as one AND-filter among feature-specific filters.
 */
export function visibilityWhere(user: SessionUser): Prisma.LeadWhereInput {
  if (user.role === "admin") return {};
  return { OR: [{ assigneeId: user.id }, { assigneeId: null }] };
}
