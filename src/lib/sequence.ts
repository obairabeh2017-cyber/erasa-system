import type { Tx } from "./tx";

/** رقم مستند تسلسلي فريد داخل المعاملة، مثل INV-000012 */
export async function nextNumber(tx: Tx, prefix: string): Promise<string> {
  const row = await tx.documentSequence.upsert({
    where: { prefix },
    create: { prefix, next: 2 },
    update: { next: { increment: 1 } },
  });
  return `${prefix}-${String(row.next - 1).padStart(6, "0")}`;
}
