import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

/** مسار ملف قاعدة البيانات من DATABASE_URL (المسار النسبي يُحسب من مجلد prisma كما يفعل Prisma). */
export function resolveDbPath(url = process.env.DATABASE_URL ?? "", root = process.cwd()): string {
  const raw = url.replace(/^file:/, "").split("?")[0];
  return path.isAbsolute(raw) ? raw : path.resolve(root, "prisma", raw);
}

/** عنوان Prisma لملف SQLite: مسار مطلق محسوب من مجلد العمل وبفواصل /. */
export function sqliteUrl(file: string, root = process.cwd()): string {
  return "file:" + path.resolve(root, file).split("\\").join("/");
}

export function backupDir(root = process.cwd()): string {
  return path.resolve(root, process.env.BACKUP_DIR || "./backups");
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** فحص سلامة ملف SQLite عبر PRAGMA integrity_check. */
export async function verifyDatabaseFile(file: string): Promise<{ ok: boolean; result: string }> {
  if (!fs.existsSync(file)) return { ok: false, result: "الملف غير موجود" };
  const client = new PrismaClient({ datasourceUrl: sqliteUrl(file) });
  try {
    const rows = await client.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
    const result = rows.map((r) => r.integrity_check).join("; ");
    return { ok: result === "ok", result };
  } finally {
    await client.$disconnect();
  }
}

/**
 * نسخة احتياطية آمنة أثناء التشغيل باستخدام `VACUUM INTO` (آلية مدعومة من SQLite تُنتج
 * لقطة متسقة حتى لو كانت هناك عمليات كتابة)، ثم فحص سلامة النسخة وحذف الأقدم من العدد المحدد.
 */
export async function createBackup(
  db: PrismaClient,
  opts: { dir?: string; keep?: number; label?: string } = {},
): Promise<{ file: string; size: number }> {
  const dir = opts.dir ?? backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const safeLabel = opts.label ? "-" + opts.label.replace(/[^a-zA-Z0-9_-]/g, "") : "";
  let file = path.join(dir, `furniture-${stamp()}${safeLabel}.db`);
  let n = 1;
  while (fs.existsSync(file)) file = path.join(dir, `furniture-${stamp()}${safeLabel}-${n++}.db`);
  // المسار نسبي إلى مجلد العمل الحالي (يعمل أيضاً في بيئات ويندوز المعزولة)
  const target = path.relative(process.cwd(), file).split("\\").join("/");
  await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const check = await verifyDatabaseFile(file);
  if (!check.ok) {
    fs.rmSync(file, { force: true });
    throw new Error(`فشل فحص سلامة النسخة الاحتياطية: ${check.result}`);
  }
  if (opts.keep && opts.keep > 0) pruneBackups(dir, opts.keep);
  return { file, size: fs.statSync(file).size };
}

export function listBackups(dir = backupDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, createdAt: st.mtime };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** يحذف الأقدم ويُبقي آخر `keep` نسخة تلقائية/يدوية (نسخ ما قبل الاستعادة لا تُحذف). */
export function pruneBackups(dir: string, keep: number) {
  const files = listBackups(dir).filter((f) => !f.name.includes("pre-restore"));
  for (const f of files.slice(keep)) fs.rmSync(path.join(dir, f.name), { force: true });
}

/**
 * استعادة نسخة احتياطية — يجب إيقاف التطبيق أولاً.
 * 1) فحص سلامة النسخة  2) حفظ نسخة من القاعدة الحالية  3) الاستبدال  4) فحص سلامة القاعدة المستعادة.
 */
export async function restoreBackup(backupFile: string, targetDb: string, safetyDir: string) {
  const pre = await verifyDatabaseFile(backupFile);
  if (!pre.ok) throw new Error(`النسخة الاحتياطية تالفة: ${pre.result}`);
  fs.mkdirSync(safetyDir, { recursive: true });
  let safetyCopy: string | null = null;
  if (fs.existsSync(targetDb)) {
    safetyCopy = path.join(safetyDir, `furniture-${stamp()}-pre-restore.db`);
    fs.copyFileSync(targetDb, safetyCopy);
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) fs.rmSync(targetDb + suffix, { force: true });
  fs.copyFileSync(backupFile, targetDb);
  const post = await verifyDatabaseFile(targetDb);
  if (!post.ok) {
    if (safetyCopy) fs.copyFileSync(safetyCopy, targetDb);
    throw new Error(`فشل فحص السلامة بعد الاستعادة، أُعيدت القاعدة السابقة: ${post.result}`);
  }
  return { safetyCopy };
}

/** نسخة تلقائية إذا مرّت المدة المحددة منذ آخر نسخة. */
export async function autoBackupIfDue(db: PrismaClient, now = new Date()) {
  const s = await db.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const intervalMs = Math.max(1, s.backupIntervalHours) * 3600_000;
  if (s.lastAutoBackupAt && now.getTime() - s.lastAutoBackupAt.getTime() < intervalMs) return null;
  const r = await createBackup(db, { keep: s.backupKeep, label: "auto" });
  await db.appSettings.update({ where: { id: 1 }, data: { lastAutoBackupAt: now } });
  return r;
}
