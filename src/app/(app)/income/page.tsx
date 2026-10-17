import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, StatusBadge, EmptyState } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { PaymentFields } from "@/components/payment-fields";
import { Pagination, listParams, type SearchParams } from "@/components/table";
import { accountOptions, categoryOptions } from "@/lib/options";
import { formatDate, todayInput } from "@/lib/dates";
import { sum, toInputDecimal } from "@/lib/money";
import { createIncomeAction, receiveIncomeAction, voidIncomeAction } from "../expenses/actions";

export const metadata = { title: "إيرادات أخرى" };

export default async function IncomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { page, skip, take } = listParams(params, ["date"] as const, "date");
  const [rows, total, categories, accounts] = await Promise.all([
    prisma.otherIncome.findMany({ include: { category: true, allocations: { where: { payment: { status: "POSTED" } } } }, orderBy: [{ date: "desc" }, { id: "desc" }], skip, take }),
    prisma.otherIncome.count(),
    categoryOptions("INCOME"),
    accountOptions(),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="إيرادات أخرى" crumbs={[{ label: "إيرادات أخرى" }]} subtitle="إيرادات خارج مبيعات الأثاث (بيع خردة، خدمات نقل…). تظهر منفصلة عن المبيعات في التقارير." />
      {rows.length === 0 ? <EmptyState title="لا توجد إيرادات أخرى" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الرقم</th><th>التاريخ</th><th>الفئة</th><th>الوصف</th><th>المبلغ</th><th>المحصّل</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const got = sum(r.allocations.map((a) => a.amount));
                return (
                  <tr key={r.id}>
                    <td className="font-mono" dir="ltr">{r.number}</td>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.category?.name ?? "—"}</td>
                    <td className="max-w-xs truncate">{r.description}</td>
                    <td><Money value={r.amount} /></td>
                    <td><Money value={got} /></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="space-y-1">
                      {r.status === "POSTED" && got < r.amount && (
                        <ActionForm action={receiveIncomeAction} className="flex flex-wrap items-center gap-1">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="date" value={todayInput()} />
                          <input name="payAmount" aria-label="المبلغ" className="input w-24 py-1 text-xs" dir="ltr" defaultValue={toInputDecimal(r.amount - got)} />
                          <select name="accountId" aria-label="الحساب" className="input w-auto py-1 text-xs">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                          <SubmitButton className="btn btn-primary btn-sm">تحصيل</SubmitButton>
                        </ActionForm>
                      )}
                      {r.status === "POSTED" && (
                        <ActionForm action={voidIncomeAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <ConfirmButton requireReason className="btn btn-secondary btn-sm" title="إلغاء الإيراد" message="ألغِ التحصيلات المرتبطة أولاً." confirmText="إلغاء">إلغاء</ConfirmButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base="/income" params={params} page={page} total={total} />
      <Section title="تسجيل إيراد آخر">
        <ActionForm action={createIncomeAction} className="space-y-3" resetOnSuccess>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label" htmlFor="i-date">التاريخ</label><input id="i-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
            <div><label className="label" htmlFor="i-cat">الفئة</label><select id="i-cat" name="categoryId" className="input"><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label" htmlFor="i-amount">المبلغ *</label><input id="i-amount" name="amount" className="input" inputMode="decimal" dir="ltr" required /></div>
            <div><label className="label" htmlFor="i-desc">الوصف *</label><input id="i-desc" name="description" className="input" required /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="receiveNow" defaultChecked className="size-4" /> تم استلام المبلغ الآن في:</label>
          <PaymentFields accounts={accounts} showAmount={false} prefix="inc" />
          <SubmitButton>تسجيل</SubmitButton>
        </ActionForm>
      </Section>
    </div>
  );
}
