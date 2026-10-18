// تحديد رابط قاعدة البيانات من أي اسم متغير تستخدمه Vercel أو Neon.
// (ربط Neon من Vercel قد يُنشئ DATABASE_URL أو POSTGRES_URL أو أسماء ببادئة مخصصة مثل STORAGE_URL)

const POOLED = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "NEON_DATABASE_URL"];
const DIRECT = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DIRECT_URL", "NEON_DATABASE_URL_UNPOOLED"];

function isPg(v) {
  return typeof v === "string" && /^postgres(ql)?:\/\//.test(v.trim());
}

function first(names, env) {
  for (const n of names) if (isPg(env[n])) return { name: n, value: env[n].trim() };
  // أي متغير ببادئة مخصصة ينتهي بنفس الاسم (مثل STORAGE_DATABASE_URL أو STORAGE_URL)
  for (const [k, v] of Object.entries(env)) {
    if (!isPg(v)) continue;
    if (names.some((n) => k.endsWith("_" + n) || (n === "DATABASE_URL" && /_URL$/.test(k) && !/UNPOOLED|NON_POOLING/.test(k)))) {
      return { name: k, value: v.trim() };
    }
  }
  return null;
}

/** يعيد { pooled, direct } أو null إن لم يوجد أي رابط PostgreSQL. */
function anyDirect(env) {
  for (const [k, v] of Object.entries(env)) if (isPg(v) && /(UNPOOLED|NON_POOLING)$/.test(k)) return { name: k, value: v.trim() };
  return null;
}

export function resolveDatabaseUrls(env = process.env) {
  const pooled = first(POOLED, env);
  const direct = first(DIRECT, env) ?? anyDirect(env) ?? pooled;
  const p = pooled ?? direct;
  if (!p) return null;
  return { pooled: p, direct: direct ?? p };
}
