// تحديد رابط قاعدة البيانات من أي اسم متغير تستخدمه Render أو Neon أو Vercel،
// مع قبول الرابط حتى لو لُصق مع نص زائد (مثل: psql 'postgresql://...' أو بين علامات تنصيص).

const POOLED = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "NEON_DATABASE_URL"];
const DIRECT = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DIRECT_URL", "NEON_DATABASE_URL_UNPOOLED"];
const PG_RE = /postgres(?:ql)?:\/\/[^\s'"`<>]+/;

/** يستخرج رابط postgresql:// من النص، أو null. */
export function extractPgUrl(v) {
  if (typeof v !== "string") return null;
  const m = PG_RE.exec(v);
  return m ? m[0] : null;
}

function first(names, env) {
  for (const n of names) {
    const u = extractPgUrl(env[n]);
    if (u) return { name: n, value: u };
  }
  // أي متغير ببادئة مخصصة ينتهي بنفس الاسم (مثل STORAGE_DATABASE_URL أو STORAGE_URL)
  for (const [k, v] of Object.entries(env)) {
    const u = extractPgUrl(v);
    if (!u) continue;
    if (names.some((n) => k.endsWith("_" + n) || (n === "DATABASE_URL" && /_URL$/.test(k) && !/UNPOOLED|NON_POOLING/.test(k)))) {
      return { name: k, value: u };
    }
  }
  return null;
}

function anyDirect(env) {
  for (const [k, v] of Object.entries(env)) {
    const u = extractPgUrl(v);
    if (u && /(UNPOOLED|NON_POOLING)$/.test(k)) return { name: k, value: u };
  }
  return null;
}

/**
 * يعيد { pooled, direct } أو null إن لم يوجد أي رابط PostgreSQL.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ pooled: { name: string, value: string }, direct: { name: string, value: string } } | null}
 */
export function resolveDatabaseUrls(env = process.env) {
  const pooled = first(POOLED, env);
  const direct = first(DIRECT, env) ?? anyDirect(env) ?? pooled;
  const p = pooled ?? direct;
  if (!p) return null;
  return { pooled: p, direct: direct ?? p };
}

/**
 * وصف المتغيرات المتعلقة بقاعدة البيانات للتشخيص — الأسماء والحالة فقط، دون أي قيمة سرية.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function describeDatabaseVars(env = process.env) {
  return Object.keys(env)
    .filter((k) => /DATABASE|POSTGRES|NEON|^PG/.test(k))
    .sort()
    .map((k) => {
      const v = env[k];
      if (!v || !v.trim()) return `${k}: فارغ (empty)`;
      if (extractPgUrl(v)) return `${k}: رابط PostgreSQL صالح`;
      const head = v.trim().slice(0, 10).replace(/[^a-zA-Z:/]/g, "?");
      return `${k}: ليس رابط PostgreSQL (يبدأ بـ "${head}…")`;
    });
}
