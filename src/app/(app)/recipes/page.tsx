import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, EmptyState, Badge, Money } from "@/components/ui";
import { FilterBar, sp, type SearchParams } from "@/components/table";
import { averageCost } from "@/lib/services/inventory";
import { mulDiv, sum } from "@/lib/money";

export const metadata = { title: "وصفات المنتجات" };

export default async function RecipesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const q = sp(params, "q");
  const products = await prisma.item.findMany({
    where: { type: "FINISHED", active: true, ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } : {}) },
    include: {
      unit: true,
      recipes: { where: { isActive: true }, include: { lines: { include: { material: true } } }, take: 1, orderBy: { version: "desc" } },
    },
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <PageHeader title="وصفات المنتجات (قائمة المواد)" crumbs={[{ label: "الوصفات" }]} subtitle="المواد الخام اللازمة لتصنيع كل منتج. تعديل الوصفة يُنشئ نسخة جديدة ولا يغيّر أوامر الإنتاج السابقة." />
      <FilterBar base="/recipes" q={q} placeholder="ابحث عن منتج" />
      {products.length === 0 ? (
        <EmptyState title="لا توجد منتجات تامة" hint="أضف منتجاً تاماً أولاً (مثل كرسي أو كنبة) ثم عرّف وصفته." action={<Link href="/items/new?type=FINISHED" className="btn btn-primary">إضافة منتج</Link>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>المنتج</th><th>الوصفة</th><th>عدد المواد</th><th>التكلفة التقديرية للوحدة (بالأسعار الحالية)</th><th></th></tr></thead>
            <tbody>
              {products.map((p) => {
                const r = p.recipes[0];
                const est = r ? mulDiv(sum(r.lines.map((l) => mulDiv(mulDiv(l.qty, 10000 + l.wasteBp, 10000), averageCost(l.material), 1000))), 1000, r.outputQty) : 0;
                return (
                  <tr key={p.id}>
                    <td className="font-medium">{p.name} <span className="text-xs text-stone-500" dir="ltr">{p.sku}</span></td>
                    <td>{r ? <Badge tone="green">النسخة {r.version}</Badge> : <Badge tone="amber">بدون وصفة</Badge>}</td>
                    <td>{r ? r.lines.length : "—"}</td>
                    <td>{r ? <Money value={est} /> : "—"}</td>
                    <td><Link href={`/recipes/${p.id}`} className="btn btn-secondary btn-sm">{r ? "عرض / تعديل" : "إنشاء وصفة"}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
