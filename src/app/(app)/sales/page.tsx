import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Money, StatusBadge, EmptyState, Badge } from "@/components/ui";
import { FilterBar, Pagination, SortTh, listParams, sp, type SearchParams } from "@/components/table";
import { formatDate, diffLocalDays } from "@/lib/dates";
import { sum } from "@/lib/money";

export const metadata = { title: "فواتير البيع" };
const SORTS = ["number", "date", "total", "dueDate"] as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { q, page, sort, dir, skip, take } = listParams(params, SORTS, "date");
  const status = sp(params, "status");
  const customerId = Number(sp(params, "customerId")) || undefined;
  const where: Prisma.SaleWhereInput = {
    ...(q ? { OR: [{ number: { contains: q } }, { customer: { name: { contains: q } } }] } : {}),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
  };
  const [rows, total, customers] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: { customer: true, returns: { where: { status: "POSTED" } }, allocations: { where: { payment: { status: "POSTED" } }, include: { payment: true } } },
      orderBy: [{ [sort]: dir }, { id: "desc" }],
      skip,
      take,
    }),
    prisma.sale.count({ where }),
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  return (
    <div>
      <PageHeader title="فواتير البيع" crumbs={[{ label: "المبيعات" }]} actions={<Link href="/sales/new" className="btn btn-primary">+ فاتورة بيع</Link>} />
      <FilterBar base="/sales" q={q} placeholder="رقم الفاتورة أو الزبون" exportHref="/api/export/sales">
        <select name="status" defaultValue={status} className="input w-auto" aria-label="الحالة">
          <option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="POSTED">مُرحّلة</option><option value="VOIDED">ملغاة</option>
        </select>
        <select name="customerId" defaultValue={customerId ?? ""} className="input w-auto" aria-label="الزبون">
          <option value="">كل الزبائن</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد فواتير بيع" hint="فاتورة البيع المُرحّلة تخصم المنتجات التامة من المخزون وتسجل دين الزبون إن لم يُدفع كامل المبلغ." action={<Link href="/sales/new" className="btn btn-primary">فاتورة بيع جديدة</Link>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh base="/sales" params={params} field="number" label="الرقم" current={sort} dir={dir} />
                <SortTh base="/sales" params={params} field="date" label="التاريخ" current={sort} dir={dir} />
                <th>الزبون</th>
                <SortTh base="/sales" params={params} field="total" label="الإجمالي" current={sort} dir={dir} />
                <th>المستلم</th><th>المتبقي</th>
                <SortTh base="/sales" params={params} field="dueDate" label="الاستحقاق" current={sort} dir={dir} />
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const received = sum(s.allocations.map((a) => (a.payment.direction === "IN" ? a.amount : -a.amount)));
                const net = s.total - sum(s.returns.map((r) => r.total));
                const remaining = net - received;
                const late = s.status === "POSTED" && remaining > 0 && s.dueDate ? diffLocalDays(s.dueDate, now) : 0;
                return (
                  <tr key={s.id}>
                    <td><Link href={`/sales/${s.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{s.number}</Link></td>
                    <td>{formatDate(s.date)}</td>
                    <td>{s.customer?.name ?? "زبون نقدي"}</td>
                    <td><Money value={net} /></td>
                    <td>{s.status === "POSTED" ? <Money value={received} /> : "—"}</td>
                    <td>{s.status === "POSTED" ? <Money value={remaining} className={remaining > 0 ? "text-red-700" : ""} /> : "—"}</td>
                    <td>{formatDate(s.dueDate)} {late > 0 && <Badge tone="red">متأخر {late} يوم</Badge>}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base="/sales" params={params} page={page} total={total} />
    </div>
  );
}
