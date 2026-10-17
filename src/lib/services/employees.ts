import type { PrismaClient } from "@prisma/client";
import { BusinessError, assert, isUniqueViolation } from "../errors";
import { sum } from "../money";
import { atomic, type Tx } from "../tx";
import { audit } from "../audit";
import { createPaymentTx } from "./payments";
import { dayOfPeriod } from "../dates";

type DbOrTx = PrismaClient | Tx;

/**
 * أثر كل نوع حركة على "المستحق للموظف" (موجب = الشركة مدينة للموظف، سالب = الموظف مدين للشركة).
 * المصروف الحقيقي للرواتب = SALARY_DUE + BONUS − DEDUCTION فقط.
 * السلفة وصرف الراتب حركات نقدية تُسوّى من المستحق، فلا تُحتسب كمصروف مرة ثانية.
 */
export const EMP_SIGN: Record<string, 1 | -1> = {
  SALARY_DUE: 1,
  BONUS: 1,
  DEDUCTION: -1,
  EXPENSE_ON_BEHALF: 1,
  SALARY_PAYMENT: -1,
  ADVANCE: -1,
  REIMBURSEMENT: -1,
  ADVANCE_REPAYMENT: 1,
};
export const CASH_OUT_TYPES = ["SALARY_PAYMENT", "ADVANCE", "REIMBURSEMENT"];
export const CASH_IN_TYPES = ["ADVANCE_REPAYMENT"];
export const ACCRUAL_TYPES = ["SALARY_DUE", "BONUS", "DEDUCTION"];
/** أنواع يمكن إدخالها مباشرة (المصروف عن الشركة يُسجّل من شاشة المصروفات). */
export const MANUAL_TYPES = ["SALARY_DUE", "BONUS", "DEDUCTION", "ADVANCE", "ADVANCE_REPAYMENT", "SALARY_PAYMENT", "REIMBURSEMENT"];

export function salaryExpenseOf(txns: { type: string; amount: number; status: string }[]): number {
  return sum(
    txns
      .filter((t) => t.status === "POSTED" && ACCRUAL_TYPES.includes(t.type))
      .map((t) => (t.type === "DEDUCTION" ? -t.amount : t.amount)),
  );
}

export async function employeeBalance(db: DbOrTx, employeeId: number) {
  const txns = await db.employeeTransaction.findMany({ where: { employeeId, status: "POSTED" } });
  const balance = sum(txns.map((t) => EMP_SIGN[t.type] * t.amount));
  const advances = sum(txns.filter((t) => t.type === "ADVANCE").map((t) => t.amount));
  const repaid = sum(txns.filter((t) => t.type === "ADVANCE_REPAYMENT").map((t) => t.amount));
  return { balance, advances, repaid };
}

export async function addEmployeeTransaction(
  db: PrismaClient,
  input: {
    employeeId: number;
    type: string;
    amount: number;
    date: Date;
    period?: string | null;
    description?: string | null;
    payment?: { accountId: number; method?: string; reference?: string | null } | null;
  },
) {
  assert(MANUAL_TYPES.includes(input.type), "نوع الحركة غير صالح");
  assert(Number.isSafeInteger(input.amount) && input.amount > 0, "المبلغ يجب أن يكون أكبر من صفر");
  const isCash = CASH_OUT_TYPES.includes(input.type) || CASH_IN_TYPES.includes(input.type);
  if (isCash) assert(input.payment?.accountId, "اختر الحساب النقدي لهذه الحركة");
  return atomic(db, async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId } });
    assert(emp, "الموظف غير موجود");
    const uniqueKey =
      input.type === "SALARY_DUE" && input.period ? `SAL:${input.employeeId}:${input.period}` : null;
    let t;
    try {
      t = await tx.employeeTransaction.create({
        data: {
          employeeId: input.employeeId,
          type: input.type,
          amount: input.amount,
          date: input.date,
          period: input.period ?? null,
          description: input.description ?? null,
          uniqueKey,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BusinessError("تم تسجيل راتب هذا الشهر لهذا الموظف مسبقاً");
      throw e;
    }
    if (isCash && input.payment) {
      await createPaymentTx(tx, {
        direction: CASH_OUT_TYPES.includes(input.type) ? "OUT" : "IN",
        kind: "EMPLOYEE",
        accountId: input.payment.accountId,
        amount: input.amount,
        date: input.date,
        method: input.payment.method,
        reference: input.payment.reference,
        employeeId: input.employeeId,
        notes: input.description,
        allocations: [{ employeeTransactionId: t.id, amount: input.amount }],
      });
    }
    await audit(tx, "EMPLOYEE_TXN", "Employee", input.employeeId, { type: input.type, amount: input.amount });
    return t;
  });
}

/** توليد الرواتب المستحقة لشهر — لا يُكرر راتب موظف لنفس الشهر. */
export async function generateSalaries(db: PrismaClient, period: string, salaryDay: number) {
  return atomic(db, async (tx) => {
    const emps = await tx.employee.findMany({ where: { active: true, baseSalary: { gt: 0 } } });
    let created = 0;
    for (const e of emps) {
      const key = `SAL:${e.id}:${period}`;
      const exists = await tx.employeeTransaction.findUnique({ where: { uniqueKey: key } });
      if (exists) continue;
      await tx.employeeTransaction.create({
        data: {
          employeeId: e.id,
          type: "SALARY_DUE",
          amount: e.baseSalary,
          date: dayOfPeriod(period, salaryDay),
          period,
          description: `راتب ${period}`,
          uniqueKey: key,
        },
      });
      created++;
    }
    await audit(tx, "SALARIES_GENERATED", "Employee", null, { period, created });
    return created;
  });
}

export async function voidEmployeeTransaction(db: PrismaClient, id: number, reason: string) {
  assert(reason.trim(), "سبب الإلغاء مطلوب");
  return atomic(db, async (tx) => {
    const t = await tx.employeeTransaction.findUnique({ where: { id }, include: { allocations: true } });
    assert(t, "الحركة غير موجودة");
    assert(t.type !== "EXPENSE_ON_BEHALF", "هذه الحركة مرتبطة بمصروف؛ ألغِ المصروف نفسه");
    const r = await tx.employeeTransaction.updateMany({
      where: { id, status: "POSTED" },
      data: { status: "VOIDED", uniqueKey: t.uniqueKey ? `${t.uniqueKey}:VOID:${id}` : null },
    });
    if (r.count !== 1) throw new BusinessError("الحركة ملغاة مسبقاً");
    const paymentIds = [...new Set(t.allocations.map((a) => a.paymentId))];
    if (paymentIds.length) {
      await tx.payment.updateMany({
        where: { id: { in: paymentIds }, status: "POSTED" },
        data: { status: "VOIDED", voidedAt: new Date() },
      });
    }
    await audit(tx, "EMPLOYEE_TXN_VOIDED", "Employee", t.employeeId, { id, reason });
  });
}
