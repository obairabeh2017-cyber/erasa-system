import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Qty, Alert } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { RecipeLinesEditor } from "@/components/lines-editor";
import { itemOptions } from "@/lib/options";
import { formatDateTime } from "@/lib/dates";
import { formatPercentBp, toInputDecimal } from "@/lib/money";
import { saveRecipeAction } from "../actions";

export default async function RecipePage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await prisma.item.findUnique({ where: { id: Number(productId) }, include: { unit: true } });
  if (!product || product.type !== "FINISHED") notFound();
  const [versions, materials] = await Promise.all([
    prisma.productRecipe.findMany({
      where: { productId: product.id },
      include: { lines: { include: { material: { include: { unit: true } } } } },
      orderBy: { version: "desc" },
    }),
    itemOptions("RAW", { includeStock: true }),
  ]);
  const active = versions.find((v) => v.isActive);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`وصفة: ${product.name}`}
        crumbs={[{ label: "الوصفات", href: "/recipes" }, { label: product.name }]}
        actions={active ? <Link href={`/production/new?productId=${product.id}`} className="btn btn-primary">+ أمر إنتاج</Link> : undefined}
      />
      {materials.length === 0 && <Alert tone="warn">لا توجد مواد خام نشطة. <Link href="/items/new" className="underline">أضف المواد الخام</Link> أولاً.</Alert>}
      <Section title={active ? `تعديل الوصفة (سيتم حفظها كنسخة ${active.version + 1})` : "إنشاء الوصفة"}>
        <ActionForm action={saveRecipeAction} className="space-y-4">
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="outputQty">هذه الكميات تكفي لإنتاج ({product.unit.name}) *</label>
              <input id="outputQty" name="outputQty" className="input" inputMode="decimal" dir="ltr" defaultValue={active ? toInputDecimal(active.outputQty) : "1"} required />
            </div>
            <div>
              <label className="label" htmlFor="notes">ملاحظات</label>
              <input id="notes" name="notes" className="input" defaultValue={active?.notes ?? ""} />
            </div>
          </div>
          <RecipeLinesEditor options={materials} initial={active?.lines.map((l) => ({ materialId: l.materialId, qty: l.qty, wasteBp: l.wasteBp })) ?? []} />
          <SubmitButton>حفظ الوصفة</SubmitButton>
        </ActionForm>
      </Section>

      <Section title="سجل نسخ الوصفة">
        {versions.length === 0 ? (
          <p className="text-sm text-stone-500">لا توجد نسخ بعد.</p>
        ) : (
          <div className="space-y-4">
            {versions.map((v) => (
              <div key={v.id} className="rounded-lg border border-stone-200 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">النسخة {v.version}</span>
                  {v.isActive ? <span className="badge bg-emerald-100 text-emerald-800">الحالية</span> : <span className="badge bg-stone-100 text-stone-600">سابقة</span>}
                  <span className="text-stone-500">{formatDateTime(v.createdAt)}</span>
                  <span className="text-stone-500">— لإنتاج <Qty value={v.outputQty} unit={product.unit.name} /></span>
                </div>
                <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                  {v.lines.map((l) => (
                    <li key={l.id}>• {l.material.name}: <Qty value={l.qty} unit={l.material.unit.name} />{l.wasteBp > 0 && <span className="text-stone-500"> + هدر {formatPercentBp(l.wasteBp)}</span>}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
