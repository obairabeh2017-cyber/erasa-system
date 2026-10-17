import type { PrismaClient } from "@prisma/client";
import { BusinessError, assert } from "../errors";
import { formatMoney, sum } from "../money";
import { atomic, type Tx } from "../tx";
import { nextNumber } from "../sequence";
import { audit } from "../audit";

type DbOrTx = PrismaClient | Tx;

export type AllocationTarget =
  | { saleId: number }
  | { purchaseId: number }
  | { expenseId: number }
  | { otherIncomeId: number }
  | { employeeTransactionId: number };

export type AllocationInput = AllocationTarget & { amount: number };

export type PaymentInput = {
  direction: "IN" | "OUT";
  kind: string;
  accountId: number;
  amount: number;
  date: Date;
  method?: string;
  reference?: string | null;
  customerId?: number | null;
  supplierId?: number | null;
  employeeId?: number | null;
  notes?: string | null;
  allocations?: AllocationInput[];
  transferId?: string | null;
};

const METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"];
const POSTED_PAYMENT = { payment: { status: "POSTED" } } as const;

// ---------- أرصدة المستندات (محسوبة دائماً من الحركات الأصلية) ----------

export async function saleOutstanding(db: DbOrTx, saleId: number): Promise<number> {
  const sale = await db.sale.findUniqueOrThrow({ where: { id: saleId } });
  if (sale.status !== "POSTED") return 0;
  const [returns, allocs] = await Promise.all([
    db.saleReturn.aggregate({ where: { saleId, status: "POSTED" }, _sum: { total: true } }),
    db.paymentAllocation.findMany({ where: { saleId, ...POSTED_PAYMENT }, include: { payment: true } }),
  ]);
  const received = sum(allocs.map((a) => (a.payment.direction === "IN" ? a.amount : -a.amount)));
  return sale.total - (returns._sum.total ?? 0) - received;
}

export async function purchaseOutstanding(db: DbOrTx, purchaseId: number): Promise<number> {
  const p = await db.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
  if (p.status !== "POSTED") return 0;
  const a = await db.paymentAllocation.aggregate({ where: { purchaseId, ...POSTED_PAYMENT }, _sum: { amount: true } });
  return p.total - (a._sum.amount ?? 0);
}

export async function expenseOutstanding(db: DbOrTx, expenseId: number): Promise<number> {
  const e = await db.expense.findUniqueOrThrow({ where: { id: expenseId } });
  if (e.status !== "POSTED" || e.paidByEmployeeId) return 0;
  const a = await db.paymentAllocation.aggregate({ where: { expenseId, ...POSTED_PAYMENT }, _sum: { amount: true } });
  return e.amount - (a._sum.amount ?? 0);
}

export async function otherIncomeOutstanding(db: DbOrTx, otherIncomeId: number): Promise<number> {
  const e = await db.otherIncome.findUniqueOrThrow({ where: { id: otherIncomeId } });
  if (e.status !== "POSTED") return 0;
  const a = await db.paymentAllocation.aggregate({
    where: { otherIncomeId, ...POSTED_PAYMENT },
    _sum: { amount: true },
  });
  return e.amount - (a._sum.amount ?? 0);
}

export async function paymentUnallocated(db: DbOrTx, paymentId: number): Promise<number> {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.kind === "TRANSFER") return 0;
  const a = await db.paymentAllocation.aggregate({ where: { paymentId }, _sum: { amount: true } });
  return p.amount - (a._sum.amount ?? 0);
}

const EMP_OUT = ["SALARY_PAYMENT", "ADVANCE", "REIMBURSEMENT"];
const EMP_IN = ["ADVANCE_REPAYMENT"];

/** يتحقق من توافق التخصيص مع الدفعة ومن عدم تجاوز المتبقي، ثم يسجّله. */
async function applyAllocations(
  tx: Tx,
  payment: { id: number; direction: string; amount: number; customerId: number | null; supplierId: number | null; employeeId: number | null; kind: string },
  allocations: AllocationInput[],
) {
  if (allocations.length === 0) return;
  assert(payment.kind !== "TRANSFER", "لا يمكن تخصيص تحويل بين الحسابات");
  const existing = await tx.paymentAllocation.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
  const available = payment.amount - (existing._sum.amount ?? 0);
  const total = sum(allocations.map((a) => a.amount));
  if (total > available) {
    throw new BusinessError(
      `مجموع التخصيص (${formatMoney(total)}) يتجاوز المبلغ غير المخصص من الدفعة (${formatMoney(available)})`,
    );
  }
  for (const a of allocations) {
    assert(Number.isSafeInteger(a.amount) && a.amount > 0, "مبلغ التخصيص يجب أن يكون أكبر من صفر");
    const targets = ["saleId", "purchaseId", "expenseId", "otherIncomeId", "employeeTransactionId"].filter(
      (k) => (a as Record<string, unknown>)[k] != null,
    );
    assert(targets.length === 1, "يجب أن يرتبط التخصيص بمستند واحد فقط");

    if ("saleId" in a) {
      const sale = await tx.sale.findUnique({ where: { id: a.saleId } });
      assert(sale && sale.status === "POSTED", "لا يمكن التخصيص إلا لفاتورة بيع مُرحّلة");
      assert(
        (sale.customerId ?? null) === (payment.customerId ?? null),
        "الدفعة والفاتورة يجب أن تخصّا الزبون نفسه",
      );
      const out = await saleOutstanding(tx, sale.id);
      if (payment.direction === "IN") {
        assert(out > 0, `فاتورة البيع ${sale.number} مسددة بالكامل`);
        assert(a.amount <= out, `المبلغ يتجاوز المتبقي على الفاتورة ${sale.number} (${formatMoney(out)})`);
      } else {
        assert(payment.kind === "SALE_REFUND", "دفعة الصرف لفاتورة بيع يجب أن تكون رد مبلغ");
        assert(-out >= a.amount, `مبلغ الرد يتجاوز المبلغ الزائد المدفوع على الفاتورة ${sale.number}`);
      }
    } else if ("purchaseId" in a) {
      assert(payment.direction === "OUT", "سداد فاتورة الشراء يكون بدفعة صرف");
      const p = await tx.purchase.findUnique({ where: { id: a.purchaseId } });
      assert(p && p.status === "POSTED", "لا يمكن التخصيص إلا لفاتورة شراء مُرحّلة");
      assert(p.supplierId === payment.supplierId, "الدفعة والفاتورة يجب أن تخصّا المورّد نفسه");
      const out = await purchaseOutstanding(tx, p.id);
      assert(a.amount <= out, `المبلغ يتجاوز المتبقي على فاتورة الشراء ${p.number} (${formatMoney(out)})`);
    } else if ("expenseId" in a) {
      assert(payment.direction === "OUT", "سداد المصروف يكون بدفعة صرف");
      const e = await tx.expense.findUnique({ where: { id: a.expenseId } });
      assert(e && e.status === "POSTED", "المصروف غير موجود أو ملغى");
      const out = await expenseOutstanding(tx, e.id);
      assert(a.amount <= out, `المبلغ يتجاوز المتبقي على المصروف ${e.number} (${formatMoney(out)})`);
    } else if ("otherIncomeId" in a) {
      assert(payment.direction === "IN", "تحصيل الإيراد يكون بدفعة قبض");
      const e = await tx.otherIncome.findUnique({ where: { id: a.otherIncomeId } });
      assert(e && e.status === "POSTED", "الإيراد غير موجود أو ملغى");
      const out = await otherIncomeOutstanding(tx, e.id);
      assert(a.amount <= out, `المبلغ يتجاوز المتبقي على الإيراد ${e.number}`);
    } else {
      const t = await tx.employeeTransaction.findUnique({ where: { id: a.employeeTransactionId } });
      assert(t && t.status === "POSTED", "حركة الموظف غير موجودة");
      assert(t.employeeId === payment.employeeId, "الدفعة والحركة يجب أن تخصّا الموظف نفسه");
      const okDir = payment.direction === "OUT" ? EMP_OUT.includes(t.type) : EMP_IN.includes(t.type);
      assert(okDir, "اتجاه الدفعة لا يتوافق مع نوع حركة الموظف");
      const prior = await tx.paymentAllocation.aggregate({
        where: { employeeTransactionId: t.id, ...POSTED_PAYMENT },
        _sum: { amount: true },
      });
      assert(a.amount + (prior._sum.amount ?? 0) <= t.amount, "المبلغ يتجاوز قيمة حركة الموظف");
    }
    await tx.paymentAllocation.create({ data: { paymentId: payment.id, ...a } });
  }
}

/** إنشاء دفعة داخل معاملة قائمة (يُستخدم عند ترحيل الفواتير). */
export async function createPaymentTx(tx: Tx, input: PaymentInput) {
  assert(input.direction === "IN" || input.direction === "OUT", "اتجاه الدفعة غير صالح");
  assert(Number.isSafeInteger(input.amount) && input.amount > 0, "مبلغ الدفعة يجب أن يكون أكبر من صفر");
  const method = input.method ?? "CASH";
  assert(METHODS.includes(method), "طريقة الدفع غير صالحة");
  const account = await tx.cashAccount.findUnique({ where: { id: input.accountId } });
  assert(account && account.active, "الحساب النقدي غير موجود أو غير نشط");
  const parties = [input.customerId, input.supplierId, input.employeeId].filter((x) => x != null);
  assert(parties.length <= 1, "الدفعة ترتبط بطرف واحد فقط");

  const number = await nextNumber(tx, input.direction === "IN" ? "RCV" : "PAY");
  const payment = await tx.payment.create({
    data: {
      number,
      direction: input.direction,
      kind: input.kind,
      accountId: input.accountId,
      amount: input.amount,
      date: input.date,
      method,
      reference: input.reference ?? null,
      customerId: input.customerId ?? null,
      supplierId: input.supplierId ?? null,
      employeeId: input.employeeId ?? null,
      notes: input.notes ?? null,
      transferId: input.transferId ?? null,
    },
  });
  await applyAllocations(tx, payment, input.allocations ?? []);
  await audit(tx, "PAYMENT_CREATED", "Payment", payment.id, { number, amount: input.amount, direction: input.direction });
  return payment;
}

export function createPayment(db: PrismaClient, input: PaymentInput) {
  return atomic(db, (tx) => createPaymentTx(tx, input));
}

/** تخصيص الجزء غير المخصص من دفعة قائمة (مثلاً دفعة من زبون على الحساب). */
export function allocatePayment(db: PrismaClient, paymentId: number, allocations: AllocationInput[]) {
  return atomic(db, async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    assert(p && p.status === "POSTED", "الدفعة غير موجودة أو ملغاة");
    await applyAllocations(tx, p, allocations);
    await audit(tx, "PAYMENT_ALLOCATED", "Payment", p.id, { allocations });
  });
}

export function removeAllocation(db: PrismaClient, allocationId: number) {
  return atomic(db, async (tx) => {
    const a = await tx.paymentAllocation.findUnique({ where: { id: allocationId }, include: { payment: true } });
    assert(a, "التخصيص غير موجود");
    assert(a.employeeTransactionId == null, "لا يمكن فك تخصيص حركة موظف؛ ألغِ الحركة نفسها");
    assert(a.payment.status === "POSTED", "الدفعة ملغاة");
    await tx.paymentAllocation.delete({ where: { id: allocationId } });
    await audit(tx, "ALLOCATION_REMOVED", "Payment", a.paymentId, { allocationId, amount: a.amount });
  });
}

/** إلغاء دفعة: تبقى في السجل بحالة ملغاة ولا تُحتسب. */
export function voidPayment(db: PrismaClient, paymentId: number, reason: string) {
  assert(reason.trim(), "سبب الإلغاء مطلوب");
  return atomic(db, async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { allocations: true } });
    assert(p, "الدفعة غير موجودة");
    const ids = p.transferId
      ? (await tx.payment.findMany({ where: { transferId: p.transferId } })).map((x) => x.id)
      : [p.id];
    const r = await tx.payment.updateMany({
      where: { id: { in: ids }, status: "POSTED" },
      data: { status: "VOIDED", voidedAt: new Date(), notes: `${p.notes ? p.notes + " | " : ""}إلغاء: ${reason}` },
    });
    if (r.count !== ids.length) throw new BusinessError("الدفعة ملغاة مسبقاً");
    // حركات الموظف المرتبطة بالدفعة تُلغى معها حتى لا يختلف رصيد الموظف عن النقدية
    const empTxnIds = p.allocations.map((a) => a.employeeTransactionId).filter((x): x is number => x != null);
    if (empTxnIds.length) {
      await tx.employeeTransaction.updateMany({ where: { id: { in: empTxnIds } }, data: { status: "VOIDED" } });
    }
    await audit(tx, "PAYMENT_VOIDED", "Payment", p.id, { reason });
  });
}

/**
 * دفعة من زبون أو إلى مورّد على الحساب، مع تخصيص تلقائي اختياري على أقدم الفواتير المفتوحة.
 * ما يزيد عن الديون يبقى «غير مخصص» ويمكن تخصيصه لاحقاً.
 */
export function createPartyPayment(
  db: PrismaClient,
  input: {
    party: { customerId: number } | { supplierId: number };
    accountId: number;
    amount: number;
    date: Date;
    method?: string;
    reference?: string | null;
    notes?: string | null;
    autoAllocate: boolean;
  },
) {
  return atomic(db, async (tx) => {
    const isCustomer = "customerId" in input.party;
    const payment = await createPaymentTx(tx, {
      direction: isCustomer ? "IN" : "OUT",
      kind: isCustomer ? "CUSTOMER_PAYMENT" : "SUPPLIER_PAYMENT",
      accountId: input.accountId,
      amount: input.amount,
      date: input.date,
      method: input.method,
      reference: input.reference,
      notes: input.notes,
      ...input.party,
    });
    if (!input.autoAllocate) return payment;
    let left = input.amount;
    const allocations: AllocationInput[] = [];
    if ("customerId" in input.party) {
      const sales = await tx.sale.findMany({ where: { customerId: input.party.customerId, status: "POSTED" }, orderBy: [{ date: "asc" }, { id: "asc" }] });
      for (const s of sales) {
        if (left <= 0) break;
        const out = await saleOutstanding(tx, s.id);
        if (out <= 0) continue;
        const a = Math.min(out, left);
        allocations.push({ saleId: s.id, amount: a });
        left -= a;
      }
    } else {
      const purchases = await tx.purchase.findMany({ where: { supplierId: input.party.supplierId, status: "POSTED" }, orderBy: [{ date: "asc" }, { id: "asc" }] });
      for (const p of purchases) {
        if (left <= 0) break;
        const out = await purchaseOutstanding(tx, p.id);
        if (out <= 0) continue;
        const a = Math.min(out, left);
        allocations.push({ purchaseId: p.id, amount: a });
        left -= a;
      }
    }
    await applyAllocations(tx, payment, allocations);
    return payment;
  });
}

export function transferBetweenAccounts(
  db: PrismaClient,
  input: { fromAccountId: number; toAccountId: number; amount: number; date: Date; notes?: string | null; reference?: string | null },
) {
  assert(input.fromAccountId !== input.toAccountId, "اختر حسابين مختلفين للتحويل");
  return atomic(db, async (tx) => {
    const transferId = `TR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const base = { kind: "TRANSFER", amount: input.amount, date: input.date, method: "BANK_TRANSFER", notes: input.notes, reference: input.reference, transferId };
    const out = await createPaymentTx(tx, { ...base, direction: "OUT", accountId: input.fromAccountId });
    const inn = await createPaymentTx(tx, { ...base, direction: "IN", accountId: input.toAccountId });
    return { out, inn };
  });
}

/** رصيد كل حساب = الرصيد الافتتاحي + المقبوضات − المدفوعات (المُرحّلة فقط). */
export async function accountBalances(db: DbOrTx, before?: Date) {
  const accounts = await db.cashAccount.findMany({ orderBy: { id: "asc" } });
  const grouped = await db.payment.groupBy({
    by: ["accountId", "direction"],
    where: { status: "POSTED", ...(before ? { date: { lt: before } } : {}) },
    _sum: { amount: true },
  });
  return accounts.map((a) => {
    const inn = grouped.find((g) => g.accountId === a.id && g.direction === "IN")?._sum.amount ?? 0;
    const out = grouped.find((g) => g.accountId === a.id && g.direction === "OUT")?._sum.amount ?? 0;
    const opening = !before || a.openingDate < before ? a.openingBalance : 0;
    return { ...a, totalIn: inn, totalOut: out, balance: opening + inn - out };
  });
}
