import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { freshDb, closeAll, Q, M, makeItem, cashAccountId } from "./helpers";
import { recordOpeningBalance, checkStockIntegrity, recordAdjustment } from "@/lib/services/inventory";
import { savePurchaseDraft, postPurchase, voidPurchase } from "@/lib/services/purchases";
import { saveRecipe, createProductionOrder, completeProductionOrder, updateProductionDraft } from "@/lib/services/production";
import { saveSaleDraft, postSale, voidSale, createSaleReturn } from "@/lib/services/sales";
import { createPayment, saleOutstanding, purchaseOutstanding, accountBalances, allocatePayment, voidPayment } from "@/lib/services/payments";
import { createExpense } from "@/lib/services/expenses";
import { addEmployeeTransaction, employeeBalance, generateSalaries } from "@/lib/services/employees";
import { computeReport, computeMonthlyReport } from "@/lib/services/reports";
import { computeDebts } from "@/lib/services/debts";
import { parseDateInput, monthRange } from "@/lib/dates";
import { mulDiv, parseDecimal, formatMoney, distribute } from "@/lib/money";

let db: PrismaClient;
const D = (s: string) => parseDateInput(s);

async function stock(id: number) {
  return (await db.item.findUniqueOrThrow({ where: { id } })).stockQty;
}

/** يجهّز: خشب 100م، إسفنج 10، قماش 50م، براغي 500، ووصفة كرسي. */
async function setupChairFactory() {
  const wood = await makeItem(db, { sku: "W-1", name: "خشب زان", type: "RAW" });
  const foam = await makeItem(db, { sku: "F-1", name: "إسفنج", type: "RAW", unit: "قطعة" });
  const fabric = await makeItem(db, { sku: "C-1", name: "قماش", type: "RAW" });
  const screws = await makeItem(db, { sku: "S-1", name: "براغي", type: "RAW", unit: "قطعة" });
  const chair = await makeItem(db, { sku: "CH-1", name: "كرسي", type: "FINISHED", salePrice: M(1000) });
  await recordOpeningBalance(db, { itemId: wood.id, qty: Q(100), unitCost: M(10), date: D("2026-01-01") });
  await recordOpeningBalance(db, { itemId: foam.id, qty: Q(10), unitCost: M(25), date: D("2026-01-01") });
  await recordOpeningBalance(db, { itemId: fabric.id, qty: Q(50), unitCost: M(8), date: D("2026-01-01") });
  await recordOpeningBalance(db, { itemId: screws.id, qty: Q(500), unitCost: M(0.1), date: D("2026-01-01") });
  await saveRecipe(db, {
    productId: chair.id,
    outputQty: Q(1),
    lines: [
      { materialId: wood.id, qty: Q(2), wasteBp: 0 },
      { materialId: foam.id, qty: Q(1), wasteBp: 0 },
      { materialId: fabric.id, qty: Q(2), wasteBp: 0 },
      { materialId: screws.id, qty: Q(10), wasteBp: 0 },
    ],
  });
  return { wood, foam, fabric, screws, chair };
}

async function supplier() {
  return db.supplier.create({ data: { name: "مورد الأخشاب" } });
}
async function customer() {
  return db.customer.create({ data: { name: "أحمد" } });
}

beforeEach(async () => {
  db = await freshDb();
});
afterAll(closeAll);

describe("أدوات المال والكميات", () => {
  it("يحلل ويحسب بدون أعداد عشرية عائمة", () => {
    expect(parseDecimal("1,234.5")).toBe(1234500);
    expect(parseDecimal("١٢٫٥")).toBe(12500);
    expect(parseDecimal("0.1")! + parseDecimal("0.2")!).toBe(parseDecimal("0.3"));
    expect(parseDecimal("1.2345")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(mulDiv(2500, 3333, 1000)).toBe(8333); // 2.5 × 3.333 = 8.3325 → 8.333
    expect(formatMoney(1234500)).toBe("1,234.50 د.ل");
    expect(distribute(100, [1, 1, 1])).toEqual([33, 33, 34]);
  });
});

describe("المخزون والمشتريات", () => {
  it("1) رصيد افتتاحي 100 متر خشب يعطي مخزون 100 متر", async () => {
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW" });
    await recordOpeningBalance(db, { itemId: wood.id, qty: Q(100), unitCost: M(10), date: D("2026-01-01") });
    expect(await stock(wood.id)).toBe(Q(100));
    const mv = await db.stockMovement.findMany({ where: { itemId: wood.id } });
    expect(mv).toHaveLength(1);
    expect(mv[0].type).toBe("OPENING");
    await expect(
      recordOpeningBalance(db, { itemId: wood.id, qty: Q(5), unitCost: M(10), date: D("2026-01-01") }),
    ).rejects.toThrow(/مسبقاً/);
  });

  it("2) شراء 20 متر إضافي يعطي 120 متر بعد الترحيل (والمسودة لا تؤثر)", async () => {
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW" });
    await recordOpeningBalance(db, { itemId: wood.id, qty: Q(100), unitCost: M(10), date: D("2026-01-01") });
    const s = await supplier();
    const draft = await savePurchaseDraft(db, {
      supplierId: s.id, date: D("2026-02-01"), discount: 0,
      lines: [{ itemId: wood.id, qty: Q(20), unitCost: M(12), lineDiscount: 0 }],
    });
    expect(await stock(wood.id)).toBe(Q(100));
    await postPurchase(db, draft.id);
    expect(await stock(wood.id)).toBe(Q(120));
    await expect(postPurchase(db, draft.id)).rejects.toThrow(/بالفعل/);
    expect(await stock(wood.id)).toBe(Q(120));
    const integrity = await checkStockIntegrity(db);
    expect(integrity.mismatches).toHaveLength(0);
  });

  it("التسوية تسجّل حركة ولا تسمح بالرصيد السالب", async () => {
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW" });
    await recordOpeningBalance(db, { itemId: wood.id, qty: Q(10), unitCost: M(10), date: D("2026-01-01") });
    await recordAdjustment(db, { itemId: wood.id, qtyDelta: -Q(3), date: D("2026-01-02"), reason: "تلف" });
    expect(await stock(wood.id)).toBe(Q(7));
    await expect(recordAdjustment(db, { itemId: wood.id, qtyDelta: -Q(8), date: D("2026-01-02"), reason: "x" })).rejects.toThrow(/غير كافٍ/);
    expect(await stock(wood.id)).toBe(Q(7));
  });

  it("9) فاتورة مورد 500 ودفع 200 تترك 300 مستحقة", async () => {
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW" });
    const s = await supplier();
    const acc = await cashAccountId(db);
    await createPayment(db, { direction: "IN", kind: "OTHER_INCOME", accountId: acc, amount: M(1000), date: D("2026-01-01") });
    const p = await savePurchaseDraft(db, {
      supplierId: s.id, date: D("2026-02-01"), discount: 0,
      lines: [{ itemId: wood.id, qty: Q(50), unitCost: M(10), lineDiscount: 0 }],
    });
    await postPurchase(db, p.id, { accountId: acc, amount: M(200) });
    expect(await purchaseOutstanding(db, p.id)).toBe(M(300));
    const debts = await computeDebts(db);
    expect(debts.totals.supplier).toBe(M(300));
    // لا يمكن الدفع بأكثر من المتبقي
    await expect(
      createPayment(db, { direction: "OUT", kind: "SUPPLIER_PAYMENT", accountId: acc, amount: M(400), date: D("2026-02-02"), supplierId: s.id, allocations: [{ purchaseId: p.id, amount: M(400) }] }),
    ).rejects.toThrow(/يتجاوز/);
  });

  it("إلغاء فاتورة الشراء يعكس المخزون", async () => {
    const wood = await makeItem(db, { sku: "W", name: "خشب", type: "RAW" });
    const s = await supplier();
    const p = await savePurchaseDraft(db, { supplierId: s.id, date: D("2026-02-01"), discount: M(10), lines: [{ itemId: wood.id, qty: Q(10), unitCost: M(10), lineDiscount: 0 }] });
    await postPurchase(db, p.id);
    const item = await db.item.findUniqueOrThrow({ where: { id: wood.id } });
    expect(item.stockValue).toBe(M(90)); // الخصم يخفض تكلفة المخزون
    await voidPurchase(db, p.id, "خطأ");
    const after = await db.item.findUniqueOrThrow({ where: { id: wood.id } });
    expect(after.stockQty).toBe(0);
    expect(after.stockValue).toBe(0);
  });
});

describe("الإنتاج", () => {
  it("3) تصنيع كرسي يستهلك الكميات الفعلية ويضيف الكرسي للمخزون التام", async () => {
    const f = await setupChairFactory();
    const order = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(1), date: D("2026-03-01") });
    // الكمية الفعلية للخشب أكثر من الوصفة (2.5 بدل 2)
    const mats = await db.productionMaterial.findMany({ where: { orderId: order.id } });
    await updateProductionDraft(db, order.id, {
      plannedQty: Q(1), completedQty: Q(1), date: D("2026-03-01"),
      materials: mats.map((m) => ({ materialId: m.materialId, actualQty: m.materialId === f.wood.id ? Q(2.5) : m.actualQty })),
    });
    const done = await completeProductionOrder(db, order.id);
    expect(await stock(f.wood.id)).toBe(Q(97.5));
    expect(await stock(f.foam.id)).toBe(Q(9));
    expect(await stock(f.fabric.id)).toBe(Q(48));
    expect(await stock(f.screws.id)).toBe(Q(490));
    expect(await stock(f.chair.id)).toBe(Q(1));
    // التكلفة: 2.5×10 + 1×25 + 2×8 + 10×0.1 = 67
    expect(done.materialCost).toBe(M(67));
    expect(done.unitCost).toBe(M(67));
    const chair = await db.item.findUniqueOrThrow({ where: { id: f.chair.id } });
    expect(chair.stockValue).toBe(M(67));
  });

  it("4) لا يمكن استهلاك مواد أكثر من المتوفر", async () => {
    const f = await setupChairFactory();
    const order = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(11), date: D("2026-03-01") });
    await expect(completeProductionOrder(db, order.id)).rejects.toThrow(/غير كافٍ/);
  });

  it("5) فشل معاملة الإنتاج يترك كل المخزون دون تغيير", async () => {
    const f = await setupChairFactory();
    // 11 كرسياً: الخشب (22) يكفي، الإسفنج (11) لا يكفي (10) → يجب ألا يُخصم الخشب أيضاً
    const order = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(11), date: D("2026-03-01") });
    const before = await db.item.findMany({ orderBy: { id: "asc" } });
    const movesBefore = await db.stockMovement.count();
    await expect(completeProductionOrder(db, order.id)).rejects.toThrow();
    const after = await db.item.findMany({ orderBy: { id: "asc" } });
    expect(after.map((i) => [i.stockQty, i.stockValue])).toEqual(before.map((i) => [i.stockQty, i.stockValue]));
    expect(await db.stockMovement.count()).toBe(movesBefore);
    const o = await db.productionOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("DRAFT");
  });

  it("6) إكمال نفس أمر الإنتاج مرتين لا يضاعف الاستهلاك (حتى بالتوازي)", async () => {
    const f = await setupChairFactory();
    const order = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(2), date: D("2026-03-01") });
    const results = await Promise.allSettled([completeProductionOrder(db, order.id), completeProductionOrder(db, order.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(completeProductionOrder(db, order.id)).rejects.toThrow(/مرة أخرى/);
    expect(await stock(f.wood.id)).toBe(Q(96));
    expect(await stock(f.chair.id)).toBe(Q(2));
  });

  it("تعديل الوصفة لا يغيّر مواد أوامر الإنتاج السابقة", async () => {
    const f = await setupChairFactory();
    const order = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(1), date: D("2026-03-01") });
    await saveRecipe(db, { productId: f.chair.id, outputQty: Q(1), lines: [{ materialId: f.wood.id, qty: Q(5), wasteBp: 1000 }] });
    const mats = await db.productionMaterial.findMany({ where: { orderId: order.id } });
    expect(mats.find((m) => m.materialId === f.wood.id)?.requiredQty).toBe(Q(2));
    expect(mats).toHaveLength(4);
    const o2 = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(2), date: D("2026-03-01") });
    const m2 = await db.productionMaterial.findMany({ where: { orderId: o2.id } });
    expect(m2).toHaveLength(1);
    expect(m2[0].requiredQty).toBe(Q(11)); // 5 × 2 × 1.10
  });
});

describe("المبيعات والمدفوعات", () => {
  async function produceChairs(n: number) {
    const f = await setupChairFactory();
    const order = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(n), date: D("2026-03-01") });
    await completeProductionOrder(db, order.id);
    return f;
  }

  it("7) بيع منتج واحد يخفض المخزون التام مرة واحدة فقط", async () => {
    const f = await produceChairs(3);
    const sale = await saveSaleDraft(db, { date: D("2026-03-05"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(1000), lineDiscount: 0 }] });
    expect(await stock(f.chair.id)).toBe(Q(3)); // المسودة لا تؤثر
    const acc = await cashAccountId(db);
    await postSale(db, sale.id, { accountId: acc, amount: M(1000) });
    expect(await stock(f.chair.id)).toBe(Q(2));
    await expect(postSale(db, sale.id)).rejects.toThrow(/بالفعل/);
    expect(await stock(f.chair.id)).toBe(Q(2));
  });

  it("8) فاتورة زبون 1000 ودفعة 300 تترك 700 مستحقة، ودفعة لاحقة على الدين", async () => {
    const f = await produceChairs(1);
    const c = await customer();
    const acc = await cashAccountId(db);
    const sale = await saveSaleDraft(db, { customerId: c.id, date: D("2026-03-05"), dueDate: D("2026-03-20"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(1000), lineDiscount: 0 }] });
    await postSale(db, sale.id, { accountId: acc, amount: M(300) });
    expect(await saleOutstanding(db, sale.id)).toBe(M(700));
    expect((await computeDebts(db)).totals.customer).toBe(M(700));
    // دفعة على الحساب ثم تخصيصها للدين
    const pay = await createPayment(db, { direction: "IN", kind: "CUSTOMER_PAYMENT", accountId: acc, amount: M(500), date: D("2026-03-10"), customerId: c.id });
    await allocatePayment(db, pay.id, [{ saleId: sale.id, amount: M(500) }]);
    expect(await saleOutstanding(db, sale.id)).toBe(M(200));
    await expect(allocatePayment(db, pay.id, [{ saleId: sale.id, amount: M(1) }])).rejects.toThrow(/يتجاوز/);
    // إلغاء الدفعة يعيد الدين
    await voidPayment(db, pay.id, "صك مرتجع");
    expect(await saleOutstanding(db, sale.id)).toBe(M(700));
  });

  it("البيع الآجل يتطلب زبوناً", async () => {
    const f = await produceChairs(1);
    const sale = await saveSaleDraft(db, { date: D("2026-03-05"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(1000), lineDiscount: 0 }] });
    await expect(postSale(db, sale.id)).rejects.toThrow(/الزبون/);
    expect(await stock(f.chair.id)).toBe(Q(1));
  });

  it("18) تكلفة المبيعات التاريخية لا تتغير بعد شراء مواد بسعر جديد", async () => {
    const f = await produceChairs(1);
    const acc = await cashAccountId(db);
    const sale = await saveSaleDraft(db, { date: D("2026-03-05"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(1000), lineDiscount: 0 }] });
    await postSale(db, sale.id, { accountId: acc, amount: M(1000) });
    const before = await db.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
    expect(before.costTotal).toBe(M(62)); // 2×10 + 25 + 2×8 + 10×0.1
    // شراء خشب بسعر أعلى بكثير وإنتاج كرسي جديد
    const s = await supplier();
    const p = await savePurchaseDraft(db, { supplierId: s.id, date: D("2026-03-10"), discount: 0, lines: [{ itemId: f.wood.id, qty: Q(100), unitCost: M(50), lineDiscount: 0 }] });
    await postPurchase(db, p.id);
    const o = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(1), date: D("2026-03-11") });
    const done = await completeProductionOrder(db, o.id);
    expect(done.unitCost).toBeGreaterThan(M(62));
    const after = await db.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
    expect(after.costTotal).toBe(before.costTotal);
    expect(after.items[0].costTotal).toBe(before.items[0].costTotal);
    const rep = await computeMonthlyReport(db, "2026-03");
    expect(rep.cogs).toBe(M(62));
  });

  it("مرتجع المبيعات يعيد المخزون ويخفض الدين، ورد المبلغ الزائد", async () => {
    const f = await produceChairs(2);
    const c = await customer();
    const acc = await cashAccountId(db);
    const sale = await saveSaleDraft(db, { customerId: c.id, date: D("2026-03-05"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(2), unitPrice: M(1000), lineDiscount: 0 }] });
    await postSale(db, sale.id, { accountId: acc, amount: M(1500) });
    expect(await stock(f.chair.id)).toBe(0);
    const items = await db.saleItem.findMany({ where: { saleId: sale.id } });
    const ret = await createSaleReturn(db, { saleId: sale.id, date: D("2026-03-06"), lines: [{ saleItemId: items[0].id, qty: Q(1) }], refund: { accountId: acc } });
    expect(ret.total).toBe(M(1000));
    expect(await stock(f.chair.id)).toBe(Q(1));
    // صافي الفاتورة 1000، مدفوع 1500 ثم رُدّ 500 → المتبقي صفر
    expect(await saleOutstanding(db, sale.id)).toBe(0);
    await expect(createSaleReturn(db, { saleId: sale.id, date: D("2026-03-06"), lines: [{ saleItemId: items[0].id, qty: Q(2) }] })).rejects.toThrow(/أكبر من المتبقي/);
    await expect(voidSale(db, sale.id, "x")).rejects.toThrow();
  });
});

describe("المصروفات والموظفين والنقدية", () => {
  it("10) مصروف نقدي يخفض الحساب الصحيح ويُسجّل مرة واحدة", async () => {
    const main = await cashAccountId(db);
    const bank = await db.cashAccount.create({ data: { name: "مصرف الجمهورية", type: "BANK", openingBalance: M(5000), openingDate: D("2026-01-01") } });
    await db.cashAccount.update({ where: { id: main }, data: { openingBalance: M(1000) } });
    const cat = await db.category.findFirstOrThrow({ where: { kind: "EXPENSE", name: "كهرباء" } });
    const e = await createExpense(db, { date: D("2026-03-03"), categoryId: cat.id, description: "فاتورة كهرباء", amount: M(150), payNow: { accountId: main } });
    const balances = await accountBalances(db);
    expect(balances.find((b) => b.id === main)!.balance).toBe(M(850));
    expect(balances.find((b) => b.id === bank.id)!.balance).toBe(M(5000));
    expect(await db.expense.count()).toBe(1);
    const rep = await computeMonthlyReport(db, "2026-03");
    expect(rep.expenses.operating).toBe(M(150));
    expect(rep.disbursements.expenses).toBe(M(150));
    // مصروف غير مدفوع لا يخفض النقدية لكنه يظهر كمصروف وكدين
    await createExpense(db, { date: D("2026-03-04"), categoryId: cat.id, description: "صيانة آجلة", amount: M(70) });
    const b2 = await accountBalances(db);
    expect(b2.find((b) => b.id === main)!.balance).toBe(M(850));
    const rep2 = await computeMonthlyReport(db, "2026-03");
    expect(rep2.expenses.operating).toBe(M(220));
    expect(rep2.debts.unpaidExpenses).toBe(M(70));
    expect(e.number).toMatch(/^EXP-/);
  });

  it("11) سلف الموظف لا تُحتسب مرتين كمصروف رواتب", async () => {
    const acc = await cashAccountId(db);
    await db.cashAccount.update({ where: { id: acc }, data: { openingBalance: M(10000) } });
    const emp = await db.employee.create({ data: { code: "E1", name: "سالم", baseSalary: M(1500), startDate: D("2025-01-01") } });
    await addEmployeeTransaction(db, { employeeId: emp.id, type: "ADVANCE", amount: M(500), date: D("2026-03-10"), payment: { accountId: acc } });
    expect(await generateSalaries(db, "2026-03", 28)).toBe(1);
    expect(await generateSalaries(db, "2026-03", 28)).toBe(0); // لا تكرار
    // صرف صافي الراتب بعد خصم السلفة
    await addEmployeeTransaction(db, { employeeId: emp.id, type: "SALARY_PAYMENT", amount: M(1000), date: D("2026-03-28"), payment: { accountId: acc } });
    const bal = await employeeBalance(db, emp.id);
    expect(bal.balance).toBe(0);
    const rep = await computeMonthlyReport(db, "2026-03");
    expect(rep.expenses.salaries).toBe(M(1500)); // ليس 2000
    expect(rep.disbursements.employees).toBe(M(1500));
    const accBal = (await accountBalances(db)).find((a) => a.id === acc)!.balance;
    expect(accBal).toBe(M(8500));
  });

  it("مصروف دفعه الموظف عن الشركة يُسجّل مرة واحدة ويصبح مستحقاً له", async () => {
    const acc = await cashAccountId(db);
    const emp = await db.employee.create({ data: { code: "E2", name: "علي", startDate: D("2025-01-01") } });
    const cat = await db.category.findFirstOrThrow({ where: { kind: "EXPENSE", name: "نقل ومواصلات" } });
    await createExpense(db, { date: D("2026-03-03"), categoryId: cat.id, description: "نقل", amount: M(40), paidByEmployeeId: emp.id });
    expect((await employeeBalance(db, emp.id)).balance).toBe(M(40));
    await addEmployeeTransaction(db, { employeeId: emp.id, type: "REIMBURSEMENT", amount: M(40), date: D("2026-03-05"), payment: { accountId: acc } });
    expect((await employeeBalance(db, emp.id)).balance).toBe(0);
    const rep = await computeMonthlyReport(db, "2026-03");
    expect(rep.expenses.operating).toBe(M(40));
    expect(rep.expenses.salaries).toBe(0);
  });
});

describe("التقارير", () => {
  it("12) المسودات والمستندات الملغاة مستبعدة من الإجماليات", async () => {
    const f = await setupChairFactory();
    const o = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(3), date: D("2026-03-01") });
    await completeProductionOrder(db, o.id);
    const acc = await cashAccountId(db);
    const c = await customer();
    const posted = await saveSaleDraft(db, { customerId: c.id, date: D("2026-03-05"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(1000), lineDiscount: 0 }] });
    await postSale(db, posted.id);
    await saveSaleDraft(db, { customerId: c.id, date: D("2026-03-06"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(900), lineDiscount: 0 }] });
    const voided = await saveSaleDraft(db, { customerId: c.id, date: D("2026-03-07"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(800), lineDiscount: 0 }] });
    await postSale(db, voided.id);
    await voidSale(db, voided.id, "خطأ");
    const cat = await db.category.findFirstOrThrow({ where: { kind: "EXPENSE", name: "إيجار" } });
    const exp = await createExpense(db, { date: D("2026-03-03"), categoryId: cat.id, description: "إيجار ملغى", amount: M(300) });
    const { voidExpense } = await import("@/lib/services/expenses");
    await voidExpense(db, exp.id, "مكرر");
    const rep = await computeMonthlyReport(db, "2026-03");
    expect(rep.sales.total).toBe(M(1000));
    expect(rep.sales.count).toBe(1);
    expect(rep.sales.excludedDrafts).toBe(1);
    expect(rep.sales.excludedVoided).toBe(1);
    expect(rep.expenses.operating).toBe(0);
    expect(rep.debts.customer).toBe(M(1000));
    expect(await stock(f.chair.id)).toBe(Q(2));
    expect(acc).toBeGreaterThan(0);
  });

  it("13) تقرير شهر محدد يطابق الحركات المُرحّلة الفعلية", async () => {
    const f = await setupChairFactory();
    const acc = await cashAccountId(db);
    const s = await supplier();
    const c = await customer();
    // فبراير: شراء
    const p = await savePurchaseDraft(db, { supplierId: s.id, date: D("2026-02-27"), discount: 0, lines: [{ itemId: f.wood.id, qty: Q(10), unitCost: M(10), lineDiscount: 0 }] });
    await postPurchase(db, p.id);
    // مارس: شراء + إنتاج + بيعتان + مصروف + دفعة
    const glue = await makeItem(db, { sku: "G-1", name: "غراء", type: "RAW", unit: "لتر" });
    const p2 = await savePurchaseDraft(db, { supplierId: s.id, date: D("2026-03-02"), discount: M(5), lines: [{ itemId: glue.id, qty: Q(10), unitCost: M(8), lineDiscount: 0 }] });
    await postPurchase(db, p2.id, { accountId: acc, amount: M(25) });
    const o = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(2), date: D("2026-03-03") });
    await completeProductionOrder(db, o.id);
    const s1 = await saveSaleDraft(db, { customerId: c.id, date: D("2026-03-10"), discount: M(50), lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(1000), lineDiscount: 0 }] });
    await postSale(db, s1.id, { accountId: acc, amount: M(400) });
    const s2 = await saveSaleDraft(db, { customerId: c.id, date: D("2026-03-31"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(800), lineDiscount: 0 }] });
    await postSale(db, s2.id);
    const cat = await db.category.findFirstOrThrow({ where: { kind: "EXPENSE", name: "إيجار" } });
    await createExpense(db, { date: D("2026-03-15"), categoryId: cat.id, description: "إيجار مارس", amount: M(600), payNow: { accountId: acc } });
    // أبريل: بيع لا يدخل تقرير مارس
    const o2 = await createProductionOrder(db, { productId: f.chair.id, plannedQty: Q(1), date: D("2026-04-01") });
    await completeProductionOrder(db, o2.id);
    const s3 = await saveSaleDraft(db, { customerId: c.id, date: D("2026-04-01"), discount: 0, lines: [{ itemId: f.chair.id, qty: Q(1), unitPrice: M(999), lineDiscount: 0 }] });
    await postSale(db, s3.id);

    const rep = await computeMonthlyReport(db, "2026-03");
    const { start, end } = monthRange("2026-03");
    const sales = await db.sale.findMany({ where: { status: "POSTED", date: { gte: start, lt: end } } });
    expect(rep.sales.total).toBe(sales.reduce((a, s) => a + s.total, 0));
    expect(rep.sales.total).toBe(M(1750));
    expect(rep.sales.discounts).toBe(M(50));
    expect(rep.cogs).toBe(M(124)); // 2 كرسي × 62
    expect(rep.grossProfit).toBe(M(1626));
    expect(rep.receipts.fromCustomers).toBe(M(400));
    expect(rep.purchases.total).toBe(M(75));
    expect(rep.purchases.discounts).toBe(M(5));
    expect(rep.materialConsumptionCost).toBe(M(124));
    expect(rep.production[0].qty).toBe(Q(2));
    expect(rep.expenses.operating).toBe(M(600));
    expect(rep.debts.customer).toBe(M(1350)); // 950−400 + 800
    expect(rep.debts.supplier).toBe(M(150)); // 100 (فبراير) + 75−25
    expect(rep.cashTotal).toBe(M(400 - 25 - 600));
    expect(rep.estimatedOperatingResult).toBe(M(1626 - 600));
    const range = await computeReport(db, start, end);
    expect(range.sales.total).toBe(rep.sales.total);
  });
});
