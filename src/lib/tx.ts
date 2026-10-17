import type { Prisma, PrismaClient } from "@prisma/client";
import { withWriteLock } from "./lock";

export type Tx = Prisma.TransactionClient;

/** معاملة ذرّية مُسلسلة: إمّا أن تُطبّق كل التغييرات أو لا شيء. */
export function atomic<T>(db: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWriteLock(() => db.$transaction(fn, { timeout: 20000, maxWait: 20000 }));
}
