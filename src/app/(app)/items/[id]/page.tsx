import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Qty, DL, Badge, Alert } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Pagination, listParams, type SearchParams } from "@/components/table";
import { categoryOptions, unitOptions } from "@/lib/options";
import { ITEM_TYPE, MOVEMENT_TYPE } from "@/lib/labels";
import { formatDate, todayInput } from "@/lib/dates";
import { averageCost } from "@/lib/services/inventory";
import { ItemForm } from "../item-form";
import { adjustStock, openingBalance, updateItem } from "../actions";

const SOURCE_LINK: Record<string, string> = { PURCHASE: "/purchases/", SALE: "/sales/", PRODUCTION: "/production/" };

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sparams = await searchParams;
  const item = await prisma.item.findUnique({ where: { id: Number(id) }, include: { unit: true, category: true } });
  if (!item) notFound();
  const { page, skip, take } = listParams(sparams, ["date"] as const, "date");
  const [movements, total, hasOpening, units, categories, recipe] = await Promise.all([
    prisma.stockMovement.findMany({ where: { itemId: item.id }, orderBy: [{ date: "desc" }, { id: "desc" }], skip, take }),
    prisma.stockMovement.count({ where: { itemId: item.id } }),
    prisma.stockMovement.count({ where: { itemId: item.id, type: "OPENING" } }),
    unitOptions(),
    categoryOptions("ITEM"),
    item.type === "FINISHED" ? prisma.productRecipe.findFirst({ where: { productId: item.id, isActive: true } }) : null,
  ]);
  const isLow = item.minStock > 0 && item.stockQty <= item.minStock;

  return (
    <div className="space-y-5">
      <PageHeader
        title={item.name}
        crumbs={[{ label: "الأصناف", href: "/items" }, { label: item.sku }]}
        subtitle={<span dir="ltr" className="font-mono">{item.sku}</span>}
        actions={item.type === "FINISHED" ? <Link href={`/recipes/${item.id}`} className="btn btn-secondary">{recipe ? "عرض الوصفة" : "إنشاء وصفة"}</Link> : undefined}
      />
      {isLow && <Alert tone="warn">الرصيد عند الحد الأدنى أو أقل منه — يُنصح بإعادة الطلب.</Alert>}
      <Section title="ملخص المخزون">
        <DL
          items={[
            ["النوع", ITEM_TYPE[item.type]],
            ["الفئة", item.category?.name ?? "—"],
            ["الرصيد الحالي", <Qty key="q" value={item.stockQty} unit={item.unit.name} />],
            ["قيمة المخزون (بالتكلفة)", <Money key="v" value={item.stockValue} />],
            ["متوسط تكلفة الوحدة", <Money key="a" value={averageCost(item)} />],
            ["الحد الأدنى", <Qty key="m" value={item.minStock} unit={item.unit.name} />],
            ["سعر البيع الافتراضي", item.type === "FINISHED" ? <Money key="p" value={item.salePrice} /> : "—"],
            ["الحالة", item.active ? <Badge key="s" tone="green">نشط</Badge> : <Badge key="s">غير نشط</Badge>],
          ]}
        />
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {hasOpening === 0 && (
          <Section title="تسجيل رصيد افتتاحي">
            <ActionForm action={openingBalance} className="grid grid-cols-1 gap-3 sm:grid-cols-2" resetOnSuccess>
              <input type="hidden" name="id" value={item.id} />
              <div><label className="label" htmlFor="ob-qty">الكمية *</label><input id="ob-qty" name="qty" className="input" inputMode="decimal" dir="ltr" required /></div>
              <div><label className="label" htmlFor="ob-cost">تكلفة الوحدة (د.ل)</label><input id="ob-cost" name="unitCost" className="input" inputMode="decimal" dir="ltr" placeholder="0" /></div>
              <div><label className="label" htmlFor="ob-date">التاريخ</label><input id="ob-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
              <div><label className="label" htmlFor="ob-notes">ملاحظات</label><input id="ob-notes" name="notes" className="input" /></div>
              <div className="sm:col-span-2"><SubmitButton>تسجيل الرصيد</SubmitButton></div>
            </ActionForm>
          </Section>
        )}
        <Section title="تسوية مخزون (جرد / تلف / تصحيح)">
          <ActionForm action={adjustStock} className="grid grid-cols-1 gap-3 sm:grid-cols-2" resetOnSuccess>
            <input type="hidden" name="id" value={item.id} />
            <div>
              <label className="label" htmlFor="adj-dir">النوع</label>
              <select id="adj-dir" name="direction" className="input"><option value="OUT">نقص (تلف/فقد/جرد)</option><option value="IN">زيادة (جرد/تصحيح)</option></select>
            </div>
            <div><label className="label" htmlFor="adj-qty">الكمية *</label><input id="adj-qty" name="qty" className="input" inputMode="decimal" dir="ltr" required /></div>
            <div><label className="label" htmlFor="adj-cost">تكلفة الوحدة للزيادة</label><input id="adj-cost" name="unitCost" className="input" inputMode="decimal" dir="ltr" placeholder="متوسط التكلفة الحالي" /></div>
            <div><label className="label" htmlFor="adj-date">التاريخ</label><input id="adj-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="adj-reason">السبب *</label><input id="adj-reason" name="reason" className="input" required /></div>
            <div className="sm:col-span-2"><SubmitButton>تسجيل التسوية</SubmitButton></div>
          </ActionForm>
        </Section>
      </div>

      <Section title="سجل حركات المخزون" actions={<a className="btn btn-secondary btn-sm" href={`/api/export/movements?itemId=${item.id}`}>⬇ CSV</a>}>
        {movements.length === 0 ? (
          <p className="text-sm text-stone-500">لا توجد حركات بعد. سجّل رصيداً افتتاحياً أو فاتورة شراء.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>القيمة</th><th>الرصيد بعد</th><th>المصدر / ملاحظات</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.date)}</td>
                    <td>{MOVEMENT_TYPE[m.type] ?? m.type}</td>
                    <td className={m.qtyDelta < 0 ? "text-red-700" : "text-emerald-700"}><Qty value={m.qtyDelta} /></td>
                    <td><Money value={m.valueDelta} /></td>
                    <td><Qty value={m.balanceAfter} unit={item.unit.name} /></td>
                    <td className="max-w-xs truncate">
                      {m.sourceId && SOURCE_LINK[m.sourceType] ? <Link className="text-brand-700 hover:underline" href={`${SOURCE_LINK[m.sourceType]}${m.sourceId}`}>{m.notes ?? "عرض"}</Link> : m.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination base={`/items/${item.id}`} params={sparams} page={page} total={total} />
      </Section>

      <Section title="تعديل بيانات الصنف">
        <ItemForm action={updateItem} item={item} units={units} categories={categories} />
      </Section>
    </div>
  );
}
