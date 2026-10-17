import { Prisma, type PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { checkStockIntegrity } from "./inventory";

/**
 * النسخ الاحتياطي: ملف JSON كامل يحتوي كل الجداول (بما فيها الإيصالات).
 * - يُنزّل من الإعدادات في أي وقت، ويُحفظ تلقائياً على القرص عند التشغيل المحلي.
 * - الاستعادة تتم في معاملة واحدة (كلها أو لا شيء) ثم يُتحقق من عدد السجلات وسلامة المخزون.
 * - على Neon تتوفر أيضاً نقاط استعادة زمنية من لوحة تحكم Neon.
 */

// ترتيب الجداول بحسب المفاتيح الأجنبية (الأب قبل الابن)
export const MODEL_ORDER = [
  "OwnerSettings", "AppSettings", "AuditLog", "DocumentSequence", "Category", "Unit", "Item", "StockMovement",
  "ProductRecipe", "RecipeLine", "ProductionOrder", "ProductionMaterial", "Supplier", "Customer", "Employee",
  "CashAccount", "RecurringExpense", "Purchase", "PurchaseItem", "Sale", "SaleItem", "SaleReturn", "SaleReturnItem",
  "Expense", "Attachment", "OtherIncome", "EmployeeTransaction", "Payment", "PaymentAllocation", "Reminder", "MonthlyReport",
] as const;

export const BACKUP_FORMAT = "erasa-backup";
export const BACKUP_VERSION = 1;

export type BackupDump = {
  format: string;
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
};

type Delegate = {
  findMany: (args?: unknown) => Promise<Record<string, unknown>[]>;
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
  count: () => Promise<number>;
};

function delegate(db: PrismaClient | Prisma.TransactionClient, model: string): Delegate {
  const key = model[0].toLowerCase() + model.slice(1);
  return (db as unknown as Record<string, Delegate>)[key];
}

function modelMeta(name: string) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === name);
  if (!m) throw new Error(`unknown model ${name}`);
  const scalars = m.fields.filter((f) => f.kind === "scalar");
  return {
    dateFields: scalars.filter((f) => f.type === "DateTime").map((f) => f.name),
    bytesFields: scalars.filter((f) => f.type === "Bytes").map((f) => f.name),
    serialId: scalars.some((f) => f.name === "id" && typeof f.default === "object" && f.default !== null && "name" in f.default && f.default.name === "autoincrement"),
  };
}

/** يصدّر كل البيانات إلى كائن JSON قابل للحفظ. */
export async function exportAll(db: PrismaClient): Promise<BackupDump> {
  const tables: BackupDump["tables"] = {};
  const counts: Record<string, number> = {};
  for (const model of MODEL_ORDER) {
    const meta = modelMeta(model);
    const rows = await delegate(db, model).findMany({ orderBy: { [model === "DocumentSequence" ? "prefix" : "id"]: "asc" } });
    tables[model] = rows.map((r) => {
      const out: Record<string, unknown> = { ...r };
      for (const f of meta.bytesFields) if (out[f]) out[f] = Buffer.from(out[f] as Uint8Array).toString("base64");
      return out;
    });
    counts[model] = rows.length;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), counts, tables };
}

export function backupFilename(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `erasa-backup-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json`;
}

/**
 * يستعيد نسخة احتياطية في معاملة واحدة.
 * بدون replace: يرفض إن كانت القاعدة الهدف تحتوي بيانات أعمال.
 * مع replace: يمسح كل الجداول أولاً (داخل نفس المعاملة، فلا يُفقد شيء إن فشلت الاستعادة).
 */
export async function importAll(db: PrismaClient, dump: BackupDump, opts: { replace?: boolean } = {}) {
  if (dump?.format !== BACKUP_FORMAT || typeof dump.tables !== "object") throw new Error("الملف ليس نسخة احتياطية صالحة لهذا البرنامج");
  if (dump.version > BACKUP_VERSION) throw new Error("النسخة الاحتياطية من إصدار أحدث من البرنامج");

  await db.$transaction(
    async (tx) => {
      if (!opts.replace) {
        const busy = (await tx.item.count()) + (await tx.sale.count()) + (await tx.payment.count()) + (await tx.employee.count());
        if (busy > 0) throw new Error("القاعدة الهدف تحتوي بيانات؛ استخدم خيار الاستبدال (--replace) بعد التأكد");
      }
      const all = [...MODEL_ORDER, "LoginAttempt"].map((m) => `"${m}"`).join(", ");
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${all} RESTART IDENTITY CASCADE`);
      for (const model of MODEL_ORDER) {
        const rows = dump.tables[model] ?? [];
        if (rows.length === 0) continue;
        const meta = modelMeta(model);
        const data = rows.map((r) => {
          const o: Record<string, unknown> = { ...r };
          for (const f of meta.dateFields) if (o[f] != null) o[f] = new Date(o[f] as string);
          for (const f of meta.bytesFields) if (o[f] != null) o[f] = new Uint8Array(Buffer.from(o[f] as string, "base64"));
          return o;
        });
        for (let i = 0; i < data.length; i += 500) await delegate(tx, model).createMany({ data: data.slice(i, i + 500) });
        if (meta.serialId) {
          // مزامنة عدّاد المعرّفات حتى لا تتعارض السجلات الجديدة مع المستعادة
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence('"${model}"', 'id'), COALESCE((SELECT MAX("id") FROM "${model}"), 1), (SELECT MAX("id") FROM "${model}") IS NOT NULL)`,
          );
        }
      }
      // التحقق من أن كل جدول استُعيد بالكامل
      for (const model of MODEL_ORDER) {
        const expected = (dump.tables[model] ?? []).length;
        const actual = await delegate(tx, model).count();
        if (actual !== expected) throw new Error(`فشل التحقق: الجدول ${model} يحتوي ${actual} بدلاً من ${expected}`);
      }
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
  const integrity = await checkStockIntegrity(db);
  if (integrity.mismatches.length) throw new Error(`تمت الاستعادة لكن أرصدة ${integrity.mismatches.length} صنف لا تطابق الحركات`);
  return { counts: dump.counts };
}

// ---------- النسخ التلقائي على القرص (التشغيل المحلي فقط) ----------

export function backupDir(root = process.cwd()): string {
  return path.resolve(root, process.env.BACKUP_DIR || "./backups");
}

export function listBackups(dir = backupDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, createdAt: st.mtime };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function pruneBackups(dir: string, keep: number) {
  for (const f of listBackups(dir).slice(keep)) fs.rmSync(path.join(dir, f.name), { force: true });
}

export async function writeBackupFile(db: PrismaClient, opts: { dir?: string; keep?: number } = {}) {
  const dir = opts.dir ?? backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupFilename());
  const json = JSON.stringify(await exportAll(db));
  fs.writeFileSync(file, json);
  // تحقق: الملف يُقرأ ويُحلّل بشكل صحيح
  const back = JSON.parse(fs.readFileSync(file, "utf8")) as BackupDump;
  if (back.format !== BACKUP_FORMAT) throw new Error("فشل التحقق من ملف النسخة");
  if (opts.keep && opts.keep > 0) pruneBackups(dir, opts.keep);
  return { file, size: json.length };
}

/** نسخة تلقائية على القرص إذا مرّت المدة المحددة (لا تعمل على Vercel لعدم وجود قرص دائم). */
export async function autoBackupIfDue(db: PrismaClient, now = new Date()) {
  if (process.env.VERCEL) return null;
  const s = await db.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const intervalMs = Math.max(1, s.backupIntervalHours) * 3600_000;
  if (s.lastAutoBackupAt && now.getTime() - s.lastAutoBackupAt.getTime() < intervalMs) return null;
  const r = await writeBackupFile(db, { keep: s.backupKeep });
  await db.appSettings.update({ where: { id: 1 }, data: { lastAutoBackupAt: now } });
  return r;
}

/** فحص الاتصال بقاعدة البيانات. */
export async function checkDatabase(db: PrismaClient): Promise<{ ok: boolean; result: string }> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, result: "ok" };
  } catch (e) {
    return { ok: false, result: e instanceof Error ? e.message : String(e) };
  }
}
