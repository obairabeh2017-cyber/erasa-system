import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Badge, Alert } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { accountBalances } from "@/lib/services/payments";
import { ACCOUNT_TYPE } from "@/lib/labels";
import { todayInput } from "@/lib/dates";
import { sum } from "@/lib/money";
import { createAccountAction, transferAction } from "./actions";

export const metadata = { title: "الخزينة والحسابات" };

export default async function CashPage() {
  const balances = await accountBalances(prisma);
  const active = balances.filter((a) => a.active);
  const total = sum(balances.map((a) => a.balance));
  return (
    <div className="space-y-5">
      <PageHeader title="الخزينة والحسابات" crumbs={[{ label: "الخزينة" }]} subtitle="الرصيد = الرصيد الافتتاحي + المقبوضات − المدفوعات المُرحّلة. الرصيد النقدي ليس هو الربح." />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>الحساب</th><th>النوع</th><th>الرصيد الافتتاحي</th><th>المقبوضات</th><th>المدفوعات</th><th>الرصيد الحالي</th><th>الحالة</th></tr></thead>
          <tbody>
            {balances.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/cash/${a.id}`} className="font-medium text-brand-700 hover:underline">{a.name}</Link></td>
                <td>{ACCOUNT_TYPE[a.type]}</td>
                <td><Money value={a.openingBalance} /></td>
                <td><Money value={a.totalIn} /></td>
                <td><Money value={a.totalOut} /></td>
                <td><Money value={a.balance} className={a.balance < 0 ? "font-bold text-red-700" : "font-bold"} /></td>
                <td>{a.active ? <Badge tone="green">نشط</Badge> : <Badge>مغلق</Badge>}</td>
              </tr>
            ))}
            <tr className="bg-stone-50 font-bold"><td colSpan={5}>إجمالي النقدية</td><td><Money value={total} /></td><td /></tr>
          </tbody>
        </table>
      </div>
      {balances.some((a) => a.balance < 0) && <Alert tone="warn">يوجد حساب برصيد سالب — تأكد من تسجيل الرصيد الافتتاحي وكل المقبوضات.</Alert>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="تحويل بين الحسابات">
          <ActionForm action={transferAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2" resetOnSuccess>
            <div><label className="label" htmlFor="t-from">من</label><select id="t-from" name="fromAccountId" className="input">{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><label className="label" htmlFor="t-to">إلى</label><select id="t-to" name="toAccountId" className="input" defaultValue={active[1]?.id}>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><label className="label" htmlFor="t-amount">المبلغ *</label><input id="t-amount" name="amount" className="input" inputMode="decimal" dir="ltr" required /></div>
            <div><label className="label" htmlFor="t-date">التاريخ</label><input id="t-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
            <div><label className="label" htmlFor="t-ref">المرجع</label><input id="t-ref" name="reference" className="input" /></div>
            <div><label className="label" htmlFor="t-notes">ملاحظات</label><input id="t-notes" name="notes" className="input" /></div>
            <div className="sm:col-span-2"><SubmitButton>تحويل</SubmitButton></div>
          </ActionForm>
        </Section>
        <Section title="إضافة حساب (خزينة أو مصرف)">
          <ActionForm action={createAccountAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2" resetOnSuccess>
            <div><label className="label" htmlFor="a-name">اسم الحساب *</label><input id="a-name" name="name" className="input" required /></div>
            <div><label className="label" htmlFor="a-type">النوع</label><select id="a-type" name="type" className="input"><option value="CASH">خزينة نقدية</option><option value="BANK">حساب مصرفي</option></select></div>
            <div><label className="label" htmlFor="a-ob">الرصيد الافتتاحي</label><input id="a-ob" name="openingBalance" className="input" inputMode="decimal" dir="ltr" placeholder="0" /></div>
            <div><label className="label" htmlFor="a-od">تاريخ الرصيد الافتتاحي</label><input id="a-od" name="openingDate" type="date" className="input" defaultValue={todayInput()} /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="a-notes">ملاحظات</label><input id="a-notes" name="notes" className="input" /></div>
            <div className="sm:col-span-2"><SubmitButton>إضافة الحساب</SubmitButton></div>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
