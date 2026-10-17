import type { Tx } from "./tx";
import type { PrismaClient } from "@prisma/client";

export async function audit(
  tx: Tx | PrismaClient,
  action: string,
  entityType: string,
  entityId: number | null,
  details?: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: { action, entityType, entityId, details: details ? JSON.stringify(details) : null },
  });
}
