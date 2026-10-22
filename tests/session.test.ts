import { describe, expect, it, vi } from "vitest";

// مفتاح الجلسة المشتق تلقائياً على الاستضافة السحابية عند غياب SESSION_SECRET
describe("مفتاح الجلسة", () => {
  it("يعمل بدون SESSION_SECRET عند وجود رابط قاعدة بيانات، ويختلف باختلاف القاعدة", async () => {
    delete process.env.SESSION_SECRET;
    process.env.DATABASE_URL = "postgresql://u:p@ep-a-pooler.eu-central-1.aws.neon.tech/db?sslmode=require";
    vi.resetModules();
    const a = await import("@/lib/auth/session");
    const token = await a.signSession(3);
    expect(await a.verifySession(token)).toEqual({ v: 3 });

    // قاعدة أخرى ⇒ مفتاح مختلف ⇒ الرمز القديم مرفوض
    process.env.DATABASE_URL = "postgresql://u:p@ep-b-pooler.eu-central-1.aws.neon.tech/db?sslmode=require";
    vi.resetModules();
    const b = await import("@/lib/auth/session");
    expect(await b.verifySession(token)).toBeNull();

    // بدون أي منهما: لا يمكن إنشاء جلسة، والتحقق يرفض بأمان
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const c = await import("@/lib/auth/session");
    await expect(c.signSession(1)).rejects.toThrow(/SESSION_SECRET/);
    expect(await c.verifySession(token)).toBeNull();
  });
});
