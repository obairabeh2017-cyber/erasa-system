import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Alert } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { sp, type SearchParams } from "@/components/table";
import { todayInput } from "@/lib/dates";
import { createOrderAction } from "../actions";

export const metadata = { title: "أمر إنتاج جديد" };

export default async function NewProductionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const products = await prisma.item.findMany({
    where: { type: "FINISHED", active: true, recipes: { some: { isActive: true } } },
    include: { unit: true },
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <PageHeader title="أمر إنتاج جديد" crumbs={[{ label: "الإنتاج", href: "/production" }, { label: "جديد" }]} />
      {products.length === 0 ? (
        <Alert tone="warn">لا توجد منتجات لها وصفة. <Link href="/recipes" className="underline">عرّف وصفة منتج</Link> أولاً.</Alert>
      ) : (
        <Section title="بيانات الأمر">
          <p className="mb-3 text-sm text-stone-600">سيُنشأ الأمر كمسودة وتُحسب المواد المطلوبة من الوصفة الحالية. لن يتغير المخزون حتى تُكمل الأمر.</p>
          <ActionForm action={createOrderAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="productId">المنتج *</label>
              <select id="productId" name="productId" className="input" defaultValue={sp(params, "productId")} required>
                <option value="">— اختر —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit.name})</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor="plannedQty">الكمية المخططة *</label><input id="plannedQty" name="plannedQty" className="input" inputMode="decimal" dir="ltr" defaultValue="1" required /></div>
            <div><label className="label" htmlFor="date">التاريخ</label><input id="date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
            <div><label className="label" htmlFor="notes">ملاحظات</label><input id="notes" name="notes" className="input" /></div>
            <div className="sm:col-span-2"><SubmitButton>إنشاء المسودة وحساب المواد</SubmitButton></div>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
