import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, StatusBadge, DL, Badge } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { PaymentFields } from "@/components/payment-fields";
import { PaymentHistory, allocationInclude } from "@/components/payment-history";
import { accountOptions } from "@/lib/options";
import { formatDate, todayInput } from "@/lib/dates";
import { toInputDecimal } from "@/lib/money";
import { expenseOutstanding } from "@/lib/services/payments";
import { payExpenseAction, voidExpenseAction } from "../actions";

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await prisma.expense.findUnique({
    where: { id: Number(id) },
    include: { category: true, employee: true, paidByEmployee: true, recurringExpense: true, allocations: { include: allocationInclude } },
  });
  if (!e) notFound();
  const [accounts, outstanding] = await Promise.all([accountOptions(), expenseOutstanding(prisma, e.id)]);
  return (
    <div className="space-y-5">
      <PageHeader title={`مصروف ${e.number}`} crumbs={[{ label: "المصروفات", href: "/expenses" }, { label: e.number }]} subtitle={<StatusBadge status={e.status} />} />
      <Section title="البيانات">
        <DL
          items={[
            ["التاريخ", formatDate(e.date)],
            ["الفئة", e.category.name],
            ["الوصف", e.description],
            ["المبلغ", <Money key="a" value={e.amount} className="font-bold" />],
            ["الموظف المرتبط", e.employee ? <Link key="em" href={`/employees/${e.employee.id}`} className="text-brand-700 hover:underline">{e.employee.name}</Link> : "—"],
            ["دفعه موظف عن الشركة", e.paidByEmployee ? <Link key="pb" href={`/employees/${e.paidByEmployee.id}`} className="text-brand-700 hover:underline">{e.paidByEmployee.name}</Link> : "—"],
            ["الاستحقاق", formatDate(e.dueDate)],
            ["مصروف دوري", e.recurringExpense ? `${e.recurringExpense.name} (${e.period})` : "—"],
            ["المتبقي للسداد", e.paidByEmployee ? <Badge key="o" tone="blue">مستحق للموظف</Badge> : <Money key="o" value={outstanding} />],
            ["الإيصال", e.receiptPath ? <a key="r" href={`/api/receipts/${e.id}`} target="_blank" className="text-brand-700 underline">📎 {e.receiptName ?? "عرض"}</a> : "—"],
          ]}
        />
        {e.notes && <p className="mt-3 text-sm text-stone-600">ملاحظات: {e.notes}</p>}
      </Section>
      <Section title="سجل السداد">
        <PaymentHistory allocations={e.allocations} />
        {e.status === "POSTED" && outstanding > 0 && (
          <ActionForm action={payExpenseAction} className="mt-4 space-y-3" resetOnSuccess>
            <input type="hidden" name="id" value={e.id} />
            <PaymentFields accounts={accounts} defaultAmount={toInputDecimal(outstanding)} requireAmount />
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="label" htmlFor="ex-date">التاريخ</label><input id="ex-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
              <SubmitButton>تسجيل السداد</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Section>
      {e.status === "POSTED" && (
        <Section title="تصحيح">
          <ActionForm action={voidExpenseAction}>
            <input type="hidden" name="id" value={e.id} />
            <ConfirmButton requireReason title="إلغاء المصروف" message="سيُستبعد المصروف من الإجماليات مع بقائه في السجل. ألغِ دفعاته أولاً إن وُجدت." confirmText="إلغاء المصروف">إلغاء المصروف</ConfirmButton>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
