import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Money, StatusBadge, EmptyState } from "@/components/ui";
import { FilterBar, Pagination, SortTh, listParams, sp, type SearchParams } from "@/components/table";
import { formatDate } from "@/lib/dates";
import { sum } from "@/lib/money";

export const metadata = { title: "فواتير الشراء" };
const SORTS = ["number", "date", "total", "dueDate"] as const;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { q, page, sort, dir, skip, take } = listParams(params, SORTS, "date");
  const status = sp(params, "status");
  const supplierId = Number(sp(params, "supplierId")) || undefined;
  const where: Prisma.PurchaseWhereInput = {
    ...(q ? { OR: [{ number: { contains: q } }, { supplierInvoiceNo: { contains: q } }, { supplier: { name: { contains: q } } }] } : {}),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
  };
  const [rows, total, suppliers] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: { supplier: true, allocations: { where: { payment: { status: "POSTED" } } } },
      orderBy: [{ [sort]: dir }, { id: "desc" }],
      skip,
      take,
    }),
    prisma.purchase.count({ where }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="فواتير الشراء" crumbs={[{ label: "المشتريات" }]} actions={<Link href="/purchases/new" className="btn btn-primary">+ فاتورة شراء</Link>} />
      <FilterBar base="/purchases" q={q} placeholder="رقم الفاتورة أو المورّد" exportHref="/api/export/purchases">
        <select name="status" defaultValue={status} className="input w-auto" aria-label="الحالة">
          <option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="POSTED">مُرحّلة</option><option value="VOIDED">ملغاة</option>
        </select>
        <select name="supplierId" defaultValue={supplierId ?? ""} className="input w-auto" aria-label="المورّد">
          <option value="">كل الموردين</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد فواتير شراء" hint="سجّل مشتريات المواد الخام لزيادة المخزون وتتبع ديون الموردين." action={<Link href="/purchases/new" className="btn btn-primary">فاتورة شراء جديدة</Link>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh base="/purchases" params={params} field="number" label="الرقم" current={sort} dir={dir} />
                <SortTh base="/purchases" params={params} field="date" label="التاريخ" current={sort} dir={dir} />
                <th>المورّد</th><th>فاتورة المورّد</th>
                <SortTh base="/purchases" params={params} field="total" label="الإجمالي" current={sort} dir={dir} />
                <th>المدفوع</th><th>المتبقي</th>
                <SortTh base="/purchases" params={params} field="dueDate" label="الاستحقاق" current={sort} dir={dir} />
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const paid = sum(p.allocations.map((a) => a.amount));
                return (
                  <tr key={p.id}>
                    <td><Link href={`/purchases/${p.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{p.number}</Link></td>
                    <td>{formatDate(p.date)}</td>
                    <td>{p.supplier.name}</td>
                    <td>{p.supplierInvoiceNo ?? "—"}</td>
                    <td><Money value={p.total} /></td>
                    <td>{p.status === "POSTED" ? <Money value={paid} /> : "—"}</td>
                    <td>{p.status === "POSTED" ? <Money value={p.total - paid} className={p.total - paid > 0 ? "text-red-700" : ""} /> : "—"}</td>
                    <td>{formatDate(p.dueDate)}</td>
                    <td><StatusBadge status={p.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base="/purchases" params={params} page={page} total={total} />
    </div>
  );
}
