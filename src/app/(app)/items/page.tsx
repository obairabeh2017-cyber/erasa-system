import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Money, Qty, Badge, EmptyState } from "@/components/ui";
import { FilterBar, Pagination, SortTh, listParams, sp, type SearchParams } from "@/components/table";
import { ITEM_TYPE } from "@/lib/labels";

export const metadata = { title: "الأصناف والمخزون" };

const SORTS = ["sku", "name", "stockQty", "stockValue"] as const;

export default async function ItemsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { q, page, sort, dir, skip, take } = listParams(params, SORTS, "name", "asc");
  const type = sp(params, "type");
  const status = sp(params, "status") || "active";
  const categoryId = Number(sp(params, "categoryId")) || undefined;
  const low = sp(params, "low") === "1";

  const where: Prisma.ItemWhereInput = {
    ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } : {}),
    ...(type === "RAW" || type === "FINISHED" ? { type } : {}),
    ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
    ...(categoryId ? { categoryId } : {}),
  };
  let items = await prisma.item.findMany({ where, include: { unit: true, category: true }, orderBy: { [sort]: dir } });
  if (low) items = items.filter((i) => i.minStock > 0 && i.stockQty <= i.minStock);
  const total = items.length;
  const pageItems = items.slice(skip, skip + take);
  const categories = await prisma.category.findMany({ where: { kind: "ITEM" }, orderBy: { name: "asc" } });

  return (
    <div>
      <PageHeader
        title="الأصناف والمخزون"
        crumbs={[{ label: "الأصناف" }]}
        subtitle="المخزون يُحسب من حركات المخزون المسجّلة ولا يُعدّل مباشرة."
        actions={<Link href="/items/new" className="btn btn-primary">+ صنف جديد</Link>}
      />
      <FilterBar base="/items" q={q} placeholder="ابحث بالاسم أو الرمز" exportHref="/api/export/items">
        <select name="type" defaultValue={type} className="input w-auto" aria-label="النوع">
          <option value="">كل الأنواع</option>
          <option value="RAW">مواد خام</option>
          <option value="FINISHED">منتجات تامة</option>
        </select>
        <select name="categoryId" defaultValue={categoryId ?? ""} className="input w-auto" aria-label="الفئة">
          <option value="">كل الفئات</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="status" defaultValue={status} className="input w-auto" aria-label="الحالة">
          <option value="active">النشطة</option>
          <option value="inactive">غير النشطة</option>
          <option value="all">الكل</option>
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={low} /> منخفض فقط</label>
      </FilterBar>
      {pageItems.length === 0 ? (
        <EmptyState title="لا توجد أصناف مطابقة" hint="أضف المواد الخام (خشب، إسفنج، قماش…) والمنتجات التامة (كراسي، كنب…)." action={<Link href="/items/new" className="btn btn-primary">إضافة صنف</Link>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh base="/items" params={params} field="sku" label="الرمز" current={sort} dir={dir} />
                <SortTh base="/items" params={params} field="name" label="الاسم" current={sort} dir={dir} />
                <th>النوع</th>
                <th>الفئة</th>
                <SortTh base="/items" params={params} field="stockQty" label="الرصيد" current={sort} dir={dir} />
                <th>الحد الأدنى</th>
                <SortTh base="/items" params={params} field="stockValue" label="قيمة المخزون" current={sort} dir={dir} />
                <th>سعر البيع</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((i) => {
                const isLow = i.minStock > 0 && i.stockQty <= i.minStock;
                return (
                  <tr key={i.id}>
                    <td className="font-mono text-xs" dir="ltr">{i.sku}</td>
                    <td>
                      <Link href={`/items/${i.id}`} className="font-medium text-brand-700 hover:underline">{i.name}</Link>
                      {!i.active && <span className="ms-2"><Badge>غير نشط</Badge></span>}
                    </td>
                    <td>{ITEM_TYPE[i.type]}</td>
                    <td>{i.category?.name ?? "—"}</td>
                    <td className={isLow ? "font-bold text-red-700" : ""}><Qty value={i.stockQty} unit={i.unit.name} />{isLow && <span className="ms-1"><Badge tone="red">منخفض</Badge></span>}</td>
                    <td><Qty value={i.minStock} /></td>
                    <td><Money value={i.stockValue} /></td>
                    <td>{i.type === "FINISHED" ? <Money value={i.salePrice} /> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base="/items" params={params} page={page} total={total} />
    </div>
  );
}
