// قفل كتابة داخل العملية: يُسلسل عمليات الترحيل حتى لا تتزاحم معاملات SQLite.
// هذا طبقة إضافية فقط؛ الضمان الأساسي هو شروط التحديث الذرّية داخل المعاملة
// (مثل: لا يُخصم المخزون إلا إذا كان الرصيد كافياً، ولا يُرحّل إلا مستند حالته مسودة).
const g = globalThis as unknown as { __writeLock?: Promise<unknown> };

export async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__writeLock ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => (release = r));
  g.__writeLock = prev.then(() => current);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}
