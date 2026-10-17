import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureDefaults } from "@/lib/services/setup";
import { sqliteUrl } from "@/lib/services/backup";

const dir = path.resolve(process.cwd(), "test-data");
const clients: PrismaClient[] = [];

/** قاعدة بيانات جديدة معزولة لكل اختبار (نسخة من القالب المُرحّل). */
export async function freshDb(): Promise<PrismaClient> {
  const file = path.join(dir, `t-${randomUUID()}.db`);
  fs.copyFileSync(path.join(dir, "template.db"), file);
  const db = new PrismaClient({ datasourceUrl: sqliteUrl(file) });
  clients.push(db);
  await ensureDefaults(db);
  return db;
}

export async function closeAll() {
  await Promise.all(clients.splice(0).map((c) => c.$disconnect()));
}

export const Q = (n: number) => Math.round(n * 1000); // كمية
export const M = (n: number) => Math.round(n * 1000); // مبلغ (دينار → درهم)

export async function unitId(db: PrismaClient, name = "متر") {
  return (await db.unit.findUniqueOrThrow({ where: { name } })).id;
}

export async function makeItem(
  db: PrismaClient,
  data: { sku: string; name: string; type: "RAW" | "FINISHED"; unit?: string; minStock?: number; salePrice?: number },
) {
  return db.item.create({
    data: {
      sku: data.sku,
      name: data.name,
      type: data.type,
      unitId: await unitId(db, data.unit ?? (data.type === "RAW" ? "متر" : "قطعة")),
      minStock: data.minStock ?? 0,
      salePrice: data.salePrice ?? 0,
    },
  });
}

export async function cashAccountId(db: PrismaClient) {
  return (await db.cashAccount.findFirstOrThrow()).id;
}
