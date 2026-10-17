import type { PrismaClient } from "@prisma/client";
import { BusinessError, assert, isUniqueViolation } from "../errors";
import { atomic } from "../tx";
import { nextNumber } from "../sequence";
import { audit } from "../audit";
import { createPaymentTx } from "./payments";

export type PayNow = { accountId: number; method?: string; reference?: string | null };

/**
 * تسجيل مصروف (يُحتسب كمصروف مرة واحدة عند حدوثه).
 * السداد يُسجّل منفصلاً كدفعة: إمّا فوراً (payNow) أو لاحقاً، أو يدفعه موظف من ماله (paidByEmployeeId)
 * فيصبح دَيناً للموظف على الشركة بدلاً من حركة نقدية.
 */
export async function createExpense(
  db: PrismaClient,
  input: {
    date: Date;
    categoryId: number;
    description: string;
    amount: number;
    dueDate?: Date | null;
    employeeId?: number | null;
    paidByEmployeeId?: number | null;
    recurringExpenseId?: number | null;
    period?: string | null;
    notes?: string | null;
    receiptPath?: string | null;
    receiptName?: string | null;
    payNow?: PayNow | null;
  },
) {
  assert(Number.isSafeInteger(input.amount) && input.amount > 0, "المبلغ يجب أن يكون أكبر من صفر");
  assert(input.description.trim(), "وصف المصروف مطلوب");
  assert(!(input.payNow && input.paidByEmployeeId), "اختر إمّا الدفع من حساب الشركة أو أن الموظف دفعه، وليس كليهما");
  return atomic(db, async (tx) => {
    const cat = await tx.category.findUnique({ where: { id: input.categoryId } });
    assert(cat && cat.kind === "EXPENSE", "فئة المصروف غير صالحة");
    const number = await nextNumber(tx, "EXP");
    let expense;
    try {
      expense = await tx.expense.create({
        data: {
          number,
          date: input.date,
          categoryId: input.categoryId,
          description: input.description.trim(),
          amount: input.amount,
          dueDate: input.dueDate ?? null,
          employeeId: input.employeeId ?? null,
          paidByEmployeeId: input.paidByEmployeeId ?? null,
          recurringExpenseId: input.recurringExpenseId ?? null,
          period: input.period ?? null,
          notes: input.notes ?? null,
          receiptPath: input.receiptPath ?? null,
          receiptName: input.receiptName ?? null,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BusinessError("تم تسجيل هذا المصروف الدوري لهذا الشهر مسبقاً");
      throw e;
    }
    if (input.paidByEmployeeId) {
      const emp = await tx.employee.findUnique({ where: { id: input.paidByEmployeeId } });
      assert(emp, "الموظف غير موجود");
      await tx.employeeTransaction.create({
        data: {
          employeeId: emp.id,
          type: "EXPENSE_ON_BEHALF",
          amount: input.amount,
          date: input.date,
          description: `${number}: ${input.description}`,
          expenseId: expense.id,
        },
      });
    }
    if (input.payNow) {
      await createPaymentTx(tx, {
        direction: "OUT",
        kind: "EXPENSE_PAYMENT",
        accountId: input.payNow.accountId,
        amount: input.amount,
        date: input.date,
        method: input.payNow.method,
        reference: input.payNow.reference,
        notes: input.description,
        allocations: [{ expenseId: expense.id, amount: input.amount }],
      });
    }
    await audit(tx, "EXPENSE_CREATED", "Expense", expense.id, { number, amount: input.amount });
    return expense;
  });
}

export async function voidExpense(db: PrismaClient, id: number, reason: string) {
  assert(reason.trim(), "سبب الإلغاء مطلوب");
  return atomic(db, async (tx) => {
    const r = await tx.expense.updateMany({
      where: { id, status: "POSTED" },
      data: { status: "VOIDED", voidedAt: new Date() },
    });
    if (r.count !== 1) throw new BusinessError("المصروف ملغى مسبقاً");
    const paid = await tx.paymentAllocation.count({ where: { expenseId: id, payment: { status: "POSTED" } } });
    assert(paid === 0, "توجد دفعات على هذا المصروف؛ ألغِ الدفعات أولاً");
    const e = await tx.expense.findUniqueOrThrow({ where: { id } });
    // فك ارتباط المصروف الدوري حتى يمكن تسجيله من جديد لنفس الشهر
    if (e.recurringExpenseId) {
      await tx.expense.update({ where: { id }, data: { recurringExpenseId: null, notes: `${e.notes ?? ""} [دوري #${e.recurringExpenseId} ${e.period}]`.trim() } });
    }
    await tx.employeeTransaction.updateMany({ where: { expenseId: id }, data: { status: "VOIDED" } });
    await audit(tx, "EXPENSE_VOIDED", "Expense", id, { reason });
  });
}

export async function createOtherIncome(
  db: PrismaClient,
  input: {
    date: Date;
    categoryId?: number | null;
    description: string;
    amount: number;
    notes?: string | null;
    receiveNow?: PayNow | null;
  },
) {
  assert(Number.isSafeInteger(input.amount) && input.amount > 0, "المبلغ يجب أن يكون أكبر من صفر");
  assert(input.description.trim(), "الوصف مطلوب");
  return atomic(db, async (tx) => {
    if (input.categoryId) {
      const cat = await tx.category.findUnique({ where: { id: input.categoryId } });
      assert(cat && cat.kind === "INCOME", "فئة الإيراد غير صالحة");
    }
    const number = await nextNumber(tx, "INC");
    const inc = await tx.otherIncome.create({
      data: {
        number,
        date: input.date,
        categoryId: input.categoryId ?? null,
        description: input.description.trim(),
        amount: input.amount,
        notes: input.notes ?? null,
      },
    });
    if (input.receiveNow) {
      await createPaymentTx(tx, {
        direction: "IN",
        kind: "OTHER_INCOME",
        accountId: input.receiveNow.accountId,
        amount: input.amount,
        date: input.date,
        method: input.receiveNow.method,
        reference: input.receiveNow.reference,
        notes: input.description,
        allocations: [{ otherIncomeId: inc.id, amount: input.amount }],
      });
    }
    await audit(tx, "OTHER_INCOME_CREATED", "OtherIncome", inc.id, { number, amount: input.amount });
    return inc;
  });
}

export async function voidOtherIncome(db: PrismaClient, id: number, reason: string) {
  assert(reason.trim(), "سبب الإلغاء مطلوب");
  return atomic(db, async (tx) => {
    const r = await tx.otherIncome.updateMany({ where: { id, status: "POSTED" }, data: { status: "VOIDED", voidedAt: new Date() } });
    if (r.count !== 1) throw new BusinessError("الإيراد ملغى مسبقاً");
    const paid = await tx.paymentAllocation.count({ where: { otherIncomeId: id, payment: { status: "POSTED" } } });
    assert(paid === 0, "توجد مقبوضات على هذا الإيراد؛ ألغِها أولاً");
    await audit(tx, "OTHER_INCOME_VOIDED", "OtherIncome", id, { reason });
  });
}
