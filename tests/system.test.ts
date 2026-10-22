import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { freshDb, emptyDb, closeAll, Q, M, makeItem } from "./helpers";
import { recordOpeningBalance, recordAdjustment } from "@/lib/services/inventory";
import { generateReminders, createCustomReminder, completeReminder } from "@/lib/services/reminders";
import { saveSaleDraft, postSale } from "@/lib/services/sales";
import { saveRecipe, createProductionOrder, completeProductionOrder } from "@/lib/services/production";
import { exportAll, importAll, type BackupDump } from "@/lib/services/backup";
import { createExpense } from "@/lib/services/expenses";
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

describe("الدخول على الإنترنت", () => {
  it("كلمة مرور ضعيفة في OWNER_PASSWORD: رسالة واضحة ولا تُحتسب محاولات فاشلة", async () => {
    const db = await freshDb();
    const { checkCredentials } = await import("@/lib/auth/owner");
    process.env.OWNER_USERNAME = "EHAB";
    process.env.OWNER_PASSWORD = "ehab77e"; // 7 أحرف
    try {
      for (let i = 0; i < 7; i++) expect(await checkCredentials(db, "EHAB", "ehab77e", "ip-w")).toMatch(/مرفوضة: كلمة المرور يجب ألا تقل عن 8 أحرف/);
      expect(await db.loginAttempt.count()).toBe(0);
      expect(await db.ownerSettings.count()).toBe(0);
      // بعد تصحيحها يُنشأ الحساب ويُقبل الدخول من نفس المصدر (لم يُقفل)
      process.env.OWNER_PASSWORD = "ehab77e1";
      expect(await checkCredentials(db, "EHAB", "ehab77e1", "ip-w")).toBeNull();
      expect((await db.ownerSettings.findUniqueOrThrow({ where: { id: 1 } })).username).toBe("EHAB");
    } finally {
      delete process.env.OWNER_USERNAME;
      delete process.env.OWNER_PASSWORD;
    }
  });

  it("ينشئ المالك من متغيرات البيئة مرة واحدة ويوقف الدخول بعد 5 محاولات فاشلة", async () => {
    const db = await freshDb();
    const { checkCredentials } = await import("@/lib/auth/owner");
    process.env.OWNER_USERNAME = "owner";
    process.env.OWNER_PASSWORD = "Strong1234";
    try {
      expect(await checkCredentials(db, "owner", "Strong1234", "ip-1")).toBeNull();
      expect(await db.ownerSettings.count()).toBe(1);
      for (let i = 0; i < 5; i++) expect(await checkCredentials(db, "owner", "wrong", "ip-2")).toMatch(/غير صحيحة/);
      // حتى كلمة المرور الصحيحة مرفوضة أثناء الإيقاف المؤقت لهذا المصدر
      expect(await checkCredentials(db, "owner", "Strong1234", "ip-2")).toMatch(/إيقاف/);
      expect(await checkCredentials(db, "owner", "Strong1234", "ip-3")).toBeNull();
      // على الحاسوب: تغيير متغيرات البيئة لاحقاً لا يغيّر المالك الموجود (يُستخدم npm run owner:set)
      process.env.OWNER_PASSWORD = "Another1234";
      expect(await checkCredentials(db, "owner", "Another1234", "ip-4")).toMatch(/غير صحيحة/);
    } finally {
      delete process.env.OWNER_USERNAME;
      delete process.env.OWNER_PASSWORD;
    }
  });

  it("على الاستضافة: الدخول بـ OWNER_USERNAME/OWNER_PASSWORD المعدّلين يعيد ضبط الحساب الموجود", async () => {
    const db = await freshDb();
    const { checkCredentials } = await import("@/lib/auth/owner");
    process.env.CLOUD_HOSTING = "true";
    process.env.OWNER_PASSWORD = "ehab77e1"; // بدون OWNER_USERNAME ⇒ يُنشأ الحساب باسم owner
    try {
      expect(await checkCredentials(db, "owner", "ehab77e1", "ip-c")).toBeNull();
      const before = await db.ownerSettings.findUniqueOrThrow({ where: { id: 1 } });

      // عُدّل اسم المستخدم بعد إنشاء الحساب: الدخول بالاسم الجديد يعيد الضبط (ولا يفرّق بين الأحرف الكبيرة والصغيرة)
      process.env.OWNER_USERNAME = "EHAB";
      expect(await checkCredentials(db, "EHAB", "wrong1234", "ip-c")).toMatch(/غير صحيحة/);
      expect(await checkCredentials(db, "ehab", "ehab77e1", "ip-c")).toBeNull();
      const after = await db.ownerSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(after.username).toBe("EHAB");
      expect(after.sessionVersion).toBe(before.sessionVersion + 1); // الجلسات القديمة تنتهي
      expect(await checkCredentials(db, "owner", "ehab77e1", "ip-d")).toMatch(/غير صحيحة/);

      // كلمة مرور جديدة في المتغير (مع مسافات زائدة بالخطأ) تُعتمد عند الدخول بها
      process.env.OWNER_PASSWORD = " NewPass99 ";
      expect(await checkCredentials(db, "EHAB", "NewPass99", "ip-d")).toBeNull();
      // وبعد حذف المتغير تبقى كلمة المرور المحفوظة هي المعتمدة
      delete process.env.OWNER_PASSWORD;
      expect(await checkCredentials(db, "EHAB", "NewPass99", "ip-e")).toBeNull();
      expect(await checkCredentials(db, "EHAB", "ehab77e1", "ip-e")).toMatch(/غير صحيحة/);
    } finally {
      delete process.env.CLOUD_HOSTING;
      delete process.env.OWNER_USERNAME;
      delete process.env.OWNER_PASSWORD;
    }
  });

  it("إعادة الضبط لمرة واحدة: تستبدل الحساب الموجود مرة واحدة فقط وعلى الاستضافة فقط", async () => {
    const db = await freshDb();
    const { applyOneTimeReset, checkCredentials } = await import("@/lib/auth/owner");
    const { hashPassword } = await import("@/lib/auth/password");
    await db.ownerSettings.create({ data: { id: 1, username: "owner", passwordHash: await hashPassword("Old12345") } });
    const reset = { id: "t-1", username: "EHAB", hash: await hashPassword("reset7k4m9") };

    expect(await applyOneTimeReset(db, "EHAB", "reset7k4m9", reset)).toBe(false); // ليس على الاستضافة
    process.env.CLOUD_HOSTING = "true";
    try {
      expect(await applyOneTimeReset(db, "EHAB", "wrong", reset)).toBe(false);
      expect(await applyOneTimeReset(db, "ehab", "reset7k4m9", reset)).toBe(true);
      const o = await db.ownerSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(o.username).toBe("EHAB");
      expect(await checkCredentials(db, "EHAB", "reset7k4m9", "ip-r")).toBeNull();
      expect(await checkCredentials(db, "owner", "Old12345", "ip-r")).toMatch(/غير صحيحة/);
      // مرة واحدة فقط: بعد تغيير كلمة المرور لا تعيدها
      await db.ownerSettings.update({ where: { id: 1 }, data: { passwordHash: await hashPassword("Changed99") } });
      expect(await applyOneTimeReset(db, "EHAB", "reset7k4m9", reset)).toBe(false);
      expect(await checkCredentials(db, "EHAB", "reset7k4m9", "ip-s")).toMatch(/غير صحيحة/);
    } finally {
      delete process.env.CLOUD_HOSTING;
    }
  });
});

describe("17) النسخ الاحتياطي والاستعادة", () => {
  it("ينشئ نسخة كاملة ويستعيدها في قاعدة اختبار جديدة", async () => {
    const db = await freshDb();
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW" });
    await recordOpeningBalance(db, { itemId: wood.id, qty: Q(100), unitCost: M(10), date: D("2026-01-01") });
    const cat = await db.category.findFirstOrThrow({ where: { kind: "EXPENSE" } });
    await createExpense(db, {
      date: D("2026-01-02"), categoryId: cat.id, description: "مع إيصال", amount: M(15),
      receipt: { name: "r.png", mime: "image/png", size: 4, data: new Uint8Array([1, 2, 3, 4]) },
    });
    const dump = JSON.parse(JSON.stringify(await exportAll(db))) as BackupDump; // كما لو حُفظ في ملف
    expect(dump.counts.Item).toBe(1);
    expect(dump.counts.Attachment).toBe(1);

    // تعديل بعد النسخة (يجب ألا يظهر بعد الاستعادة)
    await recordAdjustment(db, { itemId: wood.id, qtyDelta: -Q(40), date: D("2026-01-03"), reason: "بعد النسخة" });

    const target = await emptyDb();
    await importAll(target, dump);
    const item = await target.item.findUniqueOrThrow({ where: { sku: "W" } });
    expect(item.stockQty).toBe(Q(100));
    expect(await target.stockMovement.count()).toBe(1);
    const att = await target.attachment.findFirstOrThrow();
    expect([...att.data]).toEqual([1, 2, 3, 4]);
    // عدّادات المعرّفات مُزامنة: الإضافة الجديدة لا تتعارض
    const n = await makeItem(target, { sku: "N", name: "جديد", type: "RAW" });
    expect(n.id).toBeGreaterThan(item.id);

    // الاستعادة فوق قاعدة فيها بيانات تُرفض بدون --replace، وتنجح مع replace
    await expect(importAll(db, dump)).rejects.toThrow(/تحتوي بيانات/);
    await importAll(db, dump, { replace: true });
    expect((await db.item.findUniqueOrThrow({ where: { sku: "W" } })).stockQty).toBe(Q(100));

    // ملف تالف يُرفض والقاعدة كما هي (المعاملة تُلغى بالكامل)
    const broken = { ...dump, tables: { ...dump.tables, StockMovement: [{ id: 999, itemId: 12345 }] } } as BackupDump;
    await expect(importAll(target, broken, { replace: true })).rejects.toThrow();
    expect(await target.item.count()).toBe(2);
    await expect(importAll(target, { format: "x" } as unknown as BackupDump)).rejects.toThrow(/ليس نسخة/);
  });
});
