import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { freshDb, closeAll, Q, M, makeItem } from "./helpers";
import { recordOpeningBalance, recordAdjustment } from "@/lib/services/inventory";
import { generateReminders, createCustomReminder, completeReminder } from "@/lib/services/reminders";
import { saveSaleDraft, postSale } from "@/lib/services/sales";
import { saveRecipe, createProductionOrder, completeProductionOrder } from "@/lib/services/production";
import { createBackup, restoreBackup, verifyDatabaseFile, sqliteUrl } from "@/lib/services/backup";
import { parseDateInput } from "@/lib/dates";

const D = (s: string) => parseDateInput(s);

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
});
afterAll(closeAll);

describe("التذكيرات", () => {
  it("14) تذكير المخزون المنخفض يُنشأ عند بلوغ الحد الأدنى بالضبط", async () => {
    const db = await freshDb();
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW", minStock: Q(10) });
    await recordOpeningBalance(db, { itemId: wood.id, qty: Q(11), unitCost: M(10), date: D("2026-01-01") });
    await generateReminders(db);
    expect(await db.reminder.count({ where: { type: "LOW_STOCK", status: "OPEN" } })).toBe(0);
    await recordAdjustment(db, { itemId: wood.id, qtyDelta: -Q(1), date: D("2026-01-02"), reason: "جرد" }); // = 10 (الحد)
    await generateReminders(db);
    const r = await db.reminder.findMany({ where: { type: "LOW_STOCK" } });
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("OPEN");
    expect(r[0].entityId).toBe(wood.id);
    // عند تعافي المخزون يُغلق التذكير تلقائياً، وعند الانخفاض مجدداً تُنشأ «نوبة» جديدة واحدة
    await recordAdjustment(db, { itemId: wood.id, qtyDelta: Q(20), date: D("2026-01-03"), reason: "توريد" });
    await generateReminders(db);
    expect(await db.reminder.count({ where: { type: "LOW_STOCK", status: "OPEN" } })).toBe(0);
    await recordAdjustment(db, { itemId: wood.id, qtyDelta: -Q(25), date: D("2026-01-04"), reason: "استهلاك" });
    await generateReminders(db);
    await generateReminders(db);
    expect(await db.reminder.count({ where: { type: "LOW_STOCK" } })).toBe(2);
    expect(await db.reminder.count({ where: { type: "LOW_STOCK", status: "OPEN" } })).toBe(1);
  });

  it("15) تكرار التوليد (حتى بالتوازي) لا ينشئ تذكيرات مكررة", async () => {
    const db = await freshDb();
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW", minStock: Q(50) });
    const chair = await makeItem(db, { sku: "C", name: "كرسي", type: "FINISHED" });
    await recordOpeningBalance(db, { itemId: wood.id, qty: Q(20), unitCost: M(10), date: D("2026-01-01") });
    await saveRecipe(db, { productId: chair.id, outputQty: Q(1), lines: [{ materialId: wood.id, qty: Q(2), wasteBp: 0 }] });
    const o = await createProductionOrder(db, { productId: chair.id, plannedQty: Q(2), date: D("2026-01-02") });
    await completeProductionOrder(db, o.id);
    const c = await db.customer.create({ data: { name: "زبون" } });
    const s = await saveSaleDraft(db, { customerId: c.id, date: D("2026-01-05"), dueDate: D("2026-01-10"), discount: 0, lines: [{ itemId: chair.id, qty: Q(1), unitPrice: M(500), lineDiscount: 0 }] });
    await postSale(db, s.id);
    await db.employee.create({ data: { code: "E1", name: "موظف", baseSalary: M(1000), startDate: D("2025-01-01") } });
    const cat = await db.category.findFirstOrThrow({ where: { kind: "EXPENSE" } });
    await db.recurringExpense.create({ data: { name: "إيجار", categoryId: cat.id, amount: M(800), dayOfMonth: 28 } });

    const now = new Date("2026-01-27T10:00:00Z");
    await Promise.all([generateReminders(db, now), generateReminders(db, now), generateReminders(db, now)]);
    const first = await db.reminder.findMany({ orderBy: { id: "asc" } });
    await generateReminders(db, now);
    const second = await db.reminder.findMany({ orderBy: { id: "asc" } });
    expect(second.length).toBe(first.length);
    const keys = second.map((r) => r.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    const types = new Set(second.map((r) => r.type));
    for (const t of ["LOW_STOCK", "DEBT_OVERDUE", "SALARY", "RECURRING_EXPENSE", "MONTHLY_REPORT"]) expect(types.has(t)).toBe(true);
    expect(await db.monthlyReport.count({ where: { period: "2025-12" } })).toBe(1);

    // التذكير المخصص المتكرر: إنهاؤه مرتين لا يُنشئ الموعد التالي مرتين
    const cr = await createCustomReminder(db, { title: "تجديد الرخصة", dueDate: D("2026-02-01"), recurrence: "MONTHLY" });
    await completeReminder(db, cr.id);
    await completeReminder(db, cr.id);
    expect(await db.reminder.count({ where: { type: "CUSTOM" } })).toBe(2);
  });
});

describe("16) الحماية: المستخدم غير المصادق لا يصل للصفحات ولا للإجراءات", () => {
  it("middleware يحوّل الصفحات إلى /login ويرفض إجراءات الخادم وواجهات API", async () => {
    const { middleware } = await import("@/middleware");
    const page = await middleware(new NextRequest("http://localhost:3000/items"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/login");

    const action = await middleware(new NextRequest("http://localhost:3000/sales/new", { method: "POST", headers: { "next-action": "abc123" } }));
    expect(action.status).toBe(401);

    const api = await middleware(new NextRequest("http://localhost:3000/api/export/sales"));
    expect(api.status).toBe(401);

    const forged = await middleware(new NextRequest("http://localhost:3000/", { headers: { cookie: "fm_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciIsInYiOjF9.invalid" } }));
    expect(forged.status).toBe(307);

    const login = await middleware(new NextRequest("http://localhost:3000/login"));
    expect(login.headers.get("x-middleware-next")).toBe("1");
  });

  it("الجلسة الصالحة تمر، والجلسة القديمة تُرفض بعد تغيير كلمة المرور", async () => {
    const db = await freshDb();
    const { signSession } = await import("@/lib/auth/session");
    const { authorizeToken } = await import("@/lib/auth/owner");
    const { hashPassword } = await import("@/lib/auth/password");
    const { middleware } = await import("@/middleware");
    await db.ownerSettings.create({ data: { id: 1, username: "owner", passwordHash: await hashPassword("Secret123") } });
    const token = await signSession(1);
    const ok = await middleware(new NextRequest("http://localhost:3000/items", { headers: { cookie: `fm_session=${token}` } }));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    expect(await authorizeToken(db, token)).not.toBeNull();
    expect(await authorizeToken(db, undefined)).toBeNull();
    await db.ownerSettings.update({ where: { id: 1 }, data: { sessionVersion: { increment: 1 } } });
    expect(await authorizeToken(db, token)).toBeNull();
  });

  it("كل إجراءات الخادم ملفوفة بالتحقق من المالك (ownerAction)", () => {
    const root = path.resolve(process.cwd(), "src/app");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && fs.readFileSync(p, "utf8").trimStart().startsWith('"use server"')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      const unwrapped = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)(.*)$/gm)].filter((m) => !/=\s*ownerAction\(/.test(m[2]));
      const allowed = f.includes(path.join("login", "actions.ts")) ? ["loginAction", "logoutAction"] : [];
      expect(unwrapped.map((m) => m[1]).filter((n) => !allowed.includes(n)), f).toEqual([]);
    }
  });

  it("ownerAction يرفض التنفيذ بدون جلسة ولا يشغّل الإجراء", async () => {
    let ran = false;
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
    vi.doMock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
    vi.doMock("next/cache", () => ({ revalidatePath: () => undefined }));
    const { ownerAction } = await import("@/lib/actions");
    const act = ownerAction(async () => { ran = true; });
    await expect(act(undefined, new FormData())).rejects.toThrow("REDIRECT:/login");
    expect(ran).toBe(false);
    vi.doUnmock("next/headers");
    vi.doUnmock("next/navigation");
    vi.doUnmock("next/cache");
  });
});

describe("17) النسخ الاحتياطي والاستعادة", () => {
  it("ينشئ نسخة سليمة ويستعيدها في بيئة اختبار", async () => {
    const db = await freshDb();
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW" });
    await recordOpeningBalance(db, { itemId: wood.id, qty: Q(100), unitCost: M(10), date: D("2026-01-01") });
    const dir = path.resolve(process.cwd(), "test-data", `bk-${Date.now()}`);
    const b = await createBackup(db, { dir, keep: 5, label: "test" });
    expect((await verifyDatabaseFile(b.file)).ok).toBe(true);

    // تعديل بعد النسخة ثم الاستعادة إلى قاعدة هدف منفصلة
    await recordAdjustment(db, { itemId: wood.id, qtyDelta: -Q(40), date: D("2026-01-02"), reason: "بعد النسخة" });
    const target = path.join(dir, "restored-target.db");
    fs.copyFileSync(b.file, target); // قاعدة «حالية» ستُستبدل
    await recordAdjustment(db, { itemId: wood.id, qtyDelta: -Q(10), date: D("2026-01-03"), reason: "x" });
    const r = await restoreBackup(b.file, target, dir);
    expect(r.safetyCopy).toBeTruthy();
    expect((await verifyDatabaseFile(target)).ok).toBe(true);
    const restored = new PrismaClient({ datasourceUrl: sqliteUrl(target) });
    const item = await restored.item.findUniqueOrThrow({ where: { sku: "W" } });
    expect(item.stockQty).toBe(Q(100));
    expect(await restored.stockMovement.count()).toBe(1);
    await restored.$disconnect();

    // نسخة تالفة تُرفض ولا تمس القاعدة الهدف
    const bad = path.join(dir, "corrupt.db");
    fs.writeFileSync(bad, "not a database");
    await expect(restoreBackup(bad, target, dir)).rejects.toThrow();
    expect((await verifyDatabaseFile(target)).ok).toBe(true);
  });

  it("يحتفظ بعدد محدد فقط من النسخ", async () => {
    const db = await freshDb();
    const dir = path.resolve(process.cwd(), "test-data", `bk-keep-${Date.now()}`);
    for (let i = 0; i < 4; i++) await createBackup(db, { dir, keep: 2, label: `n${i}` });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".db")).length).toBe(2);
  });
});
