import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Money, Badge, EmptyState, Alert } from "@/components/ui";
import { FilterBar, Pagination, SortTh, listParams, sp, type SearchParams } from "@/components/table";
import { dateRange, formatDate, isDateInput } from "@/lib/dates";
import { DIRECTION, PAYMENT_KIND, PAYMENT_METHOD } from "@/lib/labels";
import { sum } from "@/lib/money";

export const metadata = { title: "المقبوضات والمدفوعات" };
const SORTS = ["number", "date", "amount"] as const;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { q, page, sort, dir, skip, take } = listParams(params, SORTS, "date");
  const direction = sp(params, "direction");
  const accountId = Number(sp(params, "accountId")) || undefined;
  const status = sp(params, "status");
  const from = sp(params, "from");
  const to = sp(params, "to");
  const range = isDateInput(from) && isDateInput(to) ? dateRange(from, to) : null;
  const where: Prisma.PaymentWhereInput = {
    ...(q ? { OR: [{ number: { contains: q } }, { reference: { contains: q } }, { notes: { contains: q } }, { customer: { name: { contains: q } } }, { supplier: { name: { contains: q } } }, { employee: { name: { contains: q } } }] } : {}),
    ...(direction ? { direction } : {}),
    ...(accountId ? { accountId } : {}),
    ...(status ? { status } : {}),
    ...(range ? { date: { gte: range.start, lt: range.end } } : {}),
  };
  const [rows, total, accounts] = await Promise.all([
    prisma.payment.findMany({ where, include: { account: true, customer: true, supplier: true, employee: true, allocations: true }, orderBy: [{ [sort]: dir }, { id: "desc" }], skip, take }),
    prisma.payment.count({ where }),
    prisma.cashAccount.findMany({ orderBy: { id: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="المقبوضات والمدفوعات" crumbs={[{ label: "المدفوعات" }]} subtitle="كل حركة نقدية فعلية. المبيعات والمصروفات تُسجّل كمستندات منفصلة عن تحصيلها أو سدادها." />
      <div className="mb-3"><Alert>لتسجيل دفعة: من صفحة الزبون/المورّد (دفعة على الحساب)، أو من الفاتورة نفسها، أو من المصروف، أو من حركات الموظف.</Alert></div>
      <FilterBar base="/payments" q={q} placeholder="رقم، مرجع، اسم الطرف" exportHref="/api/export/payments">
        <select name="direction" defaultValue={direction} className="input w-auto" aria-label="الاتجاه"><option value="">قبض وصرف</option><option value="IN">قبض</option><option value="OUT">صرف</option></select>
        <select name="accountId" defaultValue={accountId ?? ""} className="input w-auto" aria-label="الحساب"><option value="">كل الحسابات</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select name="status" defaultValue={status} className="input w-auto" aria-label="الحالة"><option value="">كل الحالات</option><option value="POSTED">مُرحّلة</option><option value="VOIDED">ملغاة</option></select>
        <input type="date" name="from" defaultValue={from} className="input w-auto" aria-label="من تاريخ" />
        <input type="date" name="to" defaultValue={to} className="input w-auto" aria-label="إلى تاريخ" />
      </FilterBar>
      {rows.length === 0 ? <EmptyState title="لا توجد حركات" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh base="/payments" params={params} field="number" label="الرقم" current={sort} dir={dir} />
                <SortTh base="/payments" params={params} field="date" label="التاريخ" current={sort} dir={dir} />
                <th>الاتجاه</th><th>النوع</th><th>الطرف</th><th>الحساب</th><th>الطريقة</th>
                <SortTh base="/payments" params={params} field="amount" label="المبلغ" current={sort} dir={dir} />
                <th>غير مخصص</th><th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const un = p.kind === "TRANSFER" ? 0 : p.amount - sum(p.allocations.map((a) => a.amount));
                return (
                  <tr key={p.id} className={p.status === "VOIDED" ? "opacity-60" : ""}>
                    <td><Link href={`/payments/${p.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{p.number}</Link></td>
                    <td>{formatDate(p.date)}</td>
                    <td>{p.direction === "IN" ? <Badge tone="green">{DIRECTION.IN}</Badge> : <Badge tone="red">{DIRECTION.OUT}</Badge>}</td>
                    <td>{PAYMENT_KIND[p.kind] ?? p.kind}</td>
                    <td>{p.customer?.name ?? p.supplier?.name ?? p.employee?.name ?? "—"}</td>
                    <td>{p.account.name}</td>
                    <td>{PAYMENT_METHOD[p.method] ?? p.method}</td>
                    <td><Money value={p.amount} /></td>
                    <td>{p.status === "POSTED" && un > 0 ? <Money value={un} className="text-amber-700" /> : "—"}</td>
                    <td>{p.status === "VOIDED" ? <Badge>ملغاة</Badge> : <Badge tone="green">مُرحّلة</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base="/payments" params={params} page={page} total={total} />
    </div>
  );
}
