import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Badge, Stat } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { PaymentFields } from "@/components/payment-fields";
import { EMP_SIGN, MANUAL_TYPES, salaryExpenseOf } from "@/lib/services/employees";
import { EMP_TXN } from "@/lib/labels";
import { formatDate, periodOf, todayInput } from "@/lib/dates";
import { accountOptions } from "@/lib/options";
import { EmployeeForm } from "../employee-form";
import { employeeTxnAction, updateEmployeeAction, voidEmployeeTxnAction } from "../actions";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await prisma.employee.findUnique({
    where: { id: Number(id) },
    include: { transactions: { include: { allocations: { include: { payment: true } }, expense: true }, orderBy: [{ date: "desc" }, { id: "desc" }] } },
  });
  if (!e) notFound();
  const accounts = await accountOptions();
  const posted = e.transactions.filter((t) => t.status === "POSTED");
  const balance = posted.reduce((a, t) => a + EMP_SIGN[t.type] * t.amount, 0);
  const advances = posted.filter((t) => t.type === "ADVANCE").reduce((a, t) => a + t.amount, 0) - posted.filter((t) => t.type === "ADVANCE_REPAYMENT").reduce((a, t) => a + t.amount, 0);
  const year = periodOf().slice(0, 4);
  const yearExpense = salaryExpenseOf(posted.filter((t) => (t.period ?? periodOf(t.date)).startsWith(year)));

  return (
    <div className="space-y-5">
      <PageHeader title={e.name} crumbs={[{ label: "الموظفون", href: "/employees" }, { label: e.name }]} subtitle={<>{e.jobTitle ?? ""} <span dir="ltr" className="font-mono">{e.code}</span> {!e.active && <Badge>غير نشط</Badge>}</>} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={balance >= 0 ? "المستحق للموظف" : "على الموظف للشركة"} value={<Money value={Math.abs(balance)} />} tone={balance < 0 ? "warn" : "default"} hint="مستحقات − مدفوعات وسلف" />
        <Stat label="سلف قائمة (إجمالي السلف − المسدد)" value={<Money value={advances} />} hint="السلفة ليست مصروفاً؛ تُسوّى من الراتب" />
        <Stat label={`مصروف الرواتب ${year}`} value={<Money value={yearExpense} />} hint="رواتب مستحقة + مكافآت − خصومات" />
      </div>

      <Section title="تسجيل حركة">
        <ActionForm action={employeeTxnAction} className="space-y-3" resetOnSuccess>
          <input type="hidden" name="id" value={e.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="t-type">نوع الحركة</label>
              <select id="t-type" name="type" className="input">
                {MANUAL_TYPES.map((t) => <option key={t} value={t}>{EMP_TXN[t]}</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor="t-amount">المبلغ *</label><input id="t-amount" name="amount" className="input" inputMode="decimal" dir="ltr" required /></div>
            <div><label className="label" htmlFor="t-date">التاريخ</label><input id="t-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
            <div><label className="label" htmlFor="t-period">شهر الراتب (للراتب المستحق)</label><input id="t-period" name="period" type="month" className="input" defaultValue={periodOf()} /></div>
            <div className="sm:col-span-2 lg:col-span-4"><label className="label" htmlFor="t-desc">البيان</label><input id="t-desc" name="description" className="input" /></div>
          </div>
          <fieldset className="rounded-lg border border-stone-200 p-3">
            <legend className="px-1 text-sm text-stone-700">للحركات النقدية فقط (صرف راتب، سلفة، تعويض، سداد سلفة)</legend>
            <PaymentFields accounts={accounts} showAmount={false} prefix="emp" />
          </fieldset>
          <SubmitButton>تسجيل</SubmitButton>
          <p className="text-xs text-stone-500">«راتب مستحق» و«مكافأة» و«خصم» تؤثر على مصروف الرواتب فقط. «صرف راتب» و«سلفة» و«تعويض» تُخرج نقداً من الحساب المحدد ولا تُحتسب مصروفاً مرة أخرى. المصروف الذي يدفعه الموظف عن الشركة يُسجّل من <Link href="/expenses/new" className="underline">شاشة المصروفات</Link>.</p>
        </ActionForm>
      </Section>

      <Section title="سجل الحركات" actions={<a className="btn btn-secondary btn-sm" href={`/api/export/employee-transactions?employeeId=${e.id}`}>⬇ CSV</a>}>
        {e.transactions.length === 0 ? <p className="text-sm text-stone-500">لا توجد حركات.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>التاريخ</th><th>النوع</th><th>الشهر</th><th>البيان</th><th>له (+)</th><th>عليه (−)</th><th>الدفعة</th><th></th></tr></thead>
              <tbody>
                {e.transactions.map((t) => (
                  <tr key={t.id} className={t.status === "VOIDED" ? "opacity-50 line-through" : ""}>
                    <td>{formatDate(t.date)}</td>
                    <td>{EMP_TXN[t.type] ?? t.type}</td>
                    <td dir="ltr" className="text-end">{t.period ?? "—"}</td>
                    <td className="max-w-xs truncate">{t.description ?? "—"}</td>
                    <td>{EMP_SIGN[t.type] > 0 ? <Money value={t.amount} /> : ""}</td>
                    <td>{EMP_SIGN[t.type] < 0 ? <Money value={t.amount} /> : ""}</td>
                    <td>{t.allocations[0] ? <Link className="font-mono text-brand-700 hover:underline" dir="ltr" href={`/payments/${t.allocations[0].paymentId}`}>{t.allocations[0].payment.number}</Link> : t.expense ? <Link className="text-brand-700 hover:underline" href={`/expenses/${t.expense.id}`}>{t.expense.number}</Link> : "—"}</td>
                    <td>
                      {t.status === "POSTED" && t.type !== "EXPENSE_ON_BEHALF" && (
                        <ActionForm action={voidEmployeeTxnAction}>
                          <input type="hidden" name="txnId" value={t.id} />
                          <ConfirmButton requireReason className="btn btn-secondary btn-sm" title="إلغاء الحركة" message="ستُلغى الحركة (والدفعة النقدية المرتبطة بها إن وُجدت) مع بقائها في السجل." confirmText="إلغاء">إلغاء</ConfirmButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="تعديل بيانات الموظف">
        <EmployeeForm action={updateEmployeeAction} employee={e} />
      </Section>
    </div>
  );
}
