import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Badge, EmptyState } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { accountOptions, categoryOptions } from "@/lib/options";
import { periodOf, formatPeriod } from "@/lib/dates";
import { createRecurringAction, recordRecurringAction, toggleRecurringAction } from "../actions";

export const metadata = { title: "المصروفات الدورية" };

export default async function RecurringPage() {
  const period = periodOf();
  const [rows, categories, accounts] = await Promise.all([
    prisma.recurringExpense.findMany({ include: { category: true, expenses: { where: { period } } }, orderBy: { name: "asc" } }),
    categoryOptions("EXPENSE"),
    accountOptions(),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="المصروفات الدورية" crumbs={[{ label: "المصروفات", href: "/expenses" }, { label: "الدورية" }]} subtitle="مثل الإيجار والكهرباء. يظهر تذكير قبل موعد كل شهر، ويُسجّل المصروف مرة واحدة فقط لكل شهر." />
      {rows.length === 0 ? <EmptyState title="لا توجد مصروفات دورية" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الاسم</th><th>الفئة</th><th>المبلغ</th><th>يوم الشهر</th><th>{formatPeriod(period)}</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.category.name}</td>
                  <td><Money value={r.amount} /></td>
                  <td>{r.dayOfMonth}</td>
                  <td>
                    {r.expenses.length > 0 ? <Badge tone="green">مُسجّل</Badge> : r.active ? (
                      <ActionForm action={recordRecurringAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="period" value={period} />
                        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="payNow" defaultChecked /> دُفع من</label>
                        <select name="accountId" className="input w-auto py-1 text-xs" aria-label="الحساب">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                        <SubmitButton className="btn btn-primary btn-sm">تسجيل هذا الشهر</SubmitButton>
                      </ActionForm>
                    ) : "—"}
                  </td>
                  <td>{r.active ? <Badge tone="green">فعّال</Badge> : <Badge>موقوف</Badge>}</td>
                  <td>
                    <ActionForm action={toggleRecurringAction} showSuccess={false}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn btn-secondary btn-sm">{r.active ? "إيقاف" : "تفعيل"}</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Section title="إضافة مصروف دوري">
        <ActionForm action={createRecurringAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" resetOnSuccess>
          <div><label className="label" htmlFor="r-name">الاسم *</label><input id="r-name" name="name" className="input" required placeholder="إيجار الورشة" /></div>
          <div><label className="label" htmlFor="r-cat">الفئة</label><select id="r-cat" name="categoryId" className="input">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="r-amount">المبلغ *</label><input id="r-amount" name="amount" className="input" inputMode="decimal" dir="ltr" required /></div>
          <div><label className="label" htmlFor="r-day">يوم الاستحقاق من الشهر</label><input id="r-day" name="dayOfMonth" type="number" min={1} max={31} className="input" defaultValue={1} /></div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="label" htmlFor="r-notes">ملاحظات</label><input id="r-notes" name="notes" className="input" /></div>
          <div className="flex items-end"><SubmitButton>إضافة</SubmitButton></div>
        </ActionForm>
      </Section>
    </div>
  );
}
