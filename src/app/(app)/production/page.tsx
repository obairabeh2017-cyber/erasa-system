import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Money, Qty, StatusBadge, EmptyState } from "@/components/ui";
import { FilterBar, Pagination, SortTh, listParams, sp, type SearchParams } from "@/components/table";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "أوامر الإنتاج" };
const SORTS = ["number", "date", "materialCost"] as const;

export default async function ProductionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { q, page, sort, dir, skip, take } = listParams(params, SORTS, "date");
  const status = sp(params, "status");
  const where: Prisma.ProductionOrderWhereInput = {
    ...(q ? { OR: [{ number: { contains: q } }, { product: { name: { contains: q } } }] } : {}),
    ...(status ? { status } : {}),
  };
  const [orders, total] = await Promise.all([
    prisma.productionOrder.findMany({ where, include: { product: { include: { unit: true } } }, orderBy: [{ [sort]: dir }, { id: "desc" }], skip, take }),
    prisma.productionOrder.count({ where }),
  ]);
  return (
    <div>
      <PageHeader title="أوامر الإنتاج" crumbs={[{ label: "الإنتاج" }]} subtitle="تكلفة الإنتاج في هذه النسخة = المواد الخام المستهلكة فعلياً فقط (بدون العمالة والتكاليف غير المباشرة)." actions={<Link href="/production/new" className="btn btn-primary">+ أمر إنتاج</Link>} />
      <FilterBar base="/production" q={q} placeholder="رقم الأمر أو المنتج" exportHref="/api/export/production">
        <select name="status" defaultValue={status} className="input w-auto" aria-label="الحالة">
          <option value="">كل الحالات</option>
          <option value="DRAFT">مسودة</option>
          <option value="COMPLETED">مكتمل</option>
          <option value="CANCELLED">ملغى</option>
          <option value="REVERSED">معكوس</option>
        </select>
      </FilterBar>
      {orders.length === 0 ? (
        <EmptyState title="لا توجد أوامر إنتاج" hint="أنشئ وصفة للمنتج ثم أمر إنتاج لخصم المواد وإضافة المنتج التام للمخزون." action={<Link href="/production/new" className="btn btn-primary">أمر إنتاج جديد</Link>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh base="/production" params={params} field="number" label="الرقم" current={sort} dir={dir} />
                <SortTh base="/production" params={params} field="date" label="التاريخ" current={sort} dir={dir} />
                <th>المنتج</th><th>المخطط</th><th>المنجز</th><th>الحالة</th>
                <SortTh base="/production" params={params} field="materialCost" label="تكلفة المواد" current={sort} dir={dir} />
                <th>تكلفة الوحدة</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/production/${o.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{o.number}</Link></td>
                  <td>{formatDate(o.date)}</td>
                  <td>{o.product.name}</td>
                  <td><Qty value={o.plannedQty} unit={o.product.unit.name} /></td>
                  <td>{o.status === "COMPLETED" ? <Qty value={o.completedQty} /> : "—"}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td>{o.status === "COMPLETED" ? <Money value={o.materialCost} /> : "—"}</td>
                  <td>{o.status === "COMPLETED" ? <Money value={o.unitCost} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base="/production" params={params} page={page} total={total} />
    </div>
  );
}
