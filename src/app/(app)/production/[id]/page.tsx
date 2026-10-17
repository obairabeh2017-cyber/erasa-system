import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Qty, StatusBadge, DL, Alert } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { ProductionMaterialsEditor } from "@/components/lines-editor";
import { itemOptions } from "@/lib/options";
import { formatDate, formatDateTime, toDateInput } from "@/lib/dates";
import { toInputDecimal } from "@/lib/money";
import { checkAvailability } from "@/lib/services/production";
import { cancelOrderAction, completeOrderAction, reverseOrderAction, updateOrderAction } from "../actions";

export default async function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.productionOrder.findUnique({
    where: { id: Number(id) },
    include: { product: { include: { unit: true } }, recipe: true, materials: { include: { material: { include: { unit: true } } } } },
  });
  if (!order) notFound();
  const isDraft = order.status === "DRAFT";
  const [availability, materials] = await Promise.all([
    isDraft ? checkAvailability(prisma, order.id) : null,
    isDraft ? itemOptions("RAW", { includeStock: true }) : [],
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`أمر إنتاج ${order.number}`}
        crumbs={[{ label: "الإنتاج", href: "/production" }, { label: order.number }]}
        subtitle={<StatusBadge status={order.status} />}
      />
      <Section title="البيانات">
        <DL
          items={[
            ["المنتج", order.product.name],
            ["التاريخ", formatDate(order.date)],
            ["الوصفة", order.recipe ? `النسخة ${order.recipe.version}` : "—"],
            ["الكمية المخططة", <Qty key="p" value={order.plannedQty} unit={order.product.unit.name} />],
            ["الكمية المنجزة", <Qty key="c" value={order.completedQty} unit={order.product.unit.name} />],
            ["تاريخ الإكمال", formatDateTime(order.completedAt)],
            ...(order.status === "COMPLETED" || order.status === "REVERSED"
              ? ([
                  ["تكلفة المواد للدفعة", <Money key="m" value={order.materialCost} />],
                  ["تكلفة المواد للوحدة", <Money key="u" value={order.unitCost} />],
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />
        {order.notes && <p className="mt-3 text-sm text-stone-600">ملاحظات: {order.notes}</p>}
        <p className="mt-3 text-xs text-stone-500">⚠️ التكلفة هنا تشمل المواد الخام المستهلكة فعلياً فقط، ولا تشمل العمالة المباشرة أو التكاليف غير المباشرة.</p>
      </Section>

      {isDraft && availability && (
        <>
          {!availability.ok && <Alert tone="danger">المخزون غير كافٍ لبعض المواد (مظللة بالأحمر). لا يمكن إكمال الأمر حتى يتوفر الرصيد أو تُعدّل الكميات.</Alert>}
          <Section title="تحرير المسودة والمواد المستهلكة فعلياً">
            <ActionForm action={updateOrderAction} className="space-y-4">
              <input type="hidden" name="id" value={order.id} />
              <div key={order.updatedAt.getTime()} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div><label className="label" htmlFor="plannedQty">الكمية المخططة</label><input id="plannedQty" name="plannedQty" className="input" inputMode="decimal" dir="ltr" defaultValue={toInputDecimal(order.plannedQty)} /></div>
                <div><label className="label" htmlFor="completedQty">الكمية المنجزة فعلياً</label><input id="completedQty" name="completedQty" className="input" inputMode="decimal" dir="ltr" defaultValue={toInputDecimal(order.completedQty)} /></div>
                <div><label className="label" htmlFor="date">التاريخ</label><input id="date" name="date" type="date" className="input" defaultValue={toDateInput(order.date)} /></div>
                <div className="sm:col-span-3"><label className="label" htmlFor="notes">ملاحظات</label><input id="notes" name="notes" className="input" defaultValue={order.notes ?? ""} /></div>
              </div>
              <ProductionMaterialsEditor key={order.updatedAt.getTime()} options={materials} initial={order.materials.map((m) => ({ materialId: m.materialId, requiredQty: m.requiredQty, actualQty: m.actualQty }))} />
              <div className="flex flex-wrap gap-2">
                <SubmitButton name="intent" value="save">حفظ المسودة</SubmitButton>
                <SubmitButton name="intent" value="recalc" className="btn btn-secondary">إعادة حساب المواد من الوصفة حسب الكمية المخططة</SubmitButton>
              </div>
            </ActionForm>
          </Section>
          <Section title="الإجراءات">
            <div className="flex flex-wrap gap-3">
              <ActionForm action={completeOrderAction}>
                <input type="hidden" name="id" value={order.id} />
                <ConfirmButton className="btn btn-primary" title="إكمال أمر الإنتاج" message="سيتم خصم المواد المحفوظة من المخزون وإضافة الكمية المنجزة للمنتج التام في عملية واحدة. احفظ أي تعديلات أولاً. لا يمكن التراجع إلا بعكس الأمر." confirmText="إكمال الأمر">
                  ✔ إكمال الأمر وتحديث المخزون
                </ConfirmButton>
              </ActionForm>
              <ActionForm action={cancelOrderAction}>
                <input type="hidden" name="id" value={order.id} />
                <ConfirmButton title="إلغاء المسودة" message="سيتم إلغاء أمر الإنتاج دون أي أثر على المخزون." confirmText="إلغاء الأمر">إلغاء الأمر</ConfirmButton>
              </ActionForm>
            </div>
          </Section>
        </>
      )}

      {!isDraft && (
        <Section title="المواد المستهلكة">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>المادة</th><th>المطلوب حسب الوصفة</th><th>المستهلك فعلياً</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead>
              <tbody>
                {order.materials.map((m) => (
                  <tr key={m.id}>
                    <td>{m.material.name}</td>
                    <td><Qty value={m.requiredQty} unit={m.material.unit.name} /></td>
                    <td><Qty value={m.actualQty} unit={m.material.unit.name} /></td>
                    <td>{order.status === "CANCELLED" ? "—" : <Money value={m.unitCost} />}</td>
                    <td>{order.status === "CANCELLED" ? "—" : <Money value={m.totalCost} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {order.status === "COMPLETED" && (
            <div className="mt-4">
              <ActionForm action={reverseOrderAction}>
                <input type="hidden" name="id" value={order.id} />
                <ConfirmButton requireReason title="عكس أمر الإنتاج" message="سيتم إخراج المنتج التام من المخزون وإعادة المواد بتكلفتها المسجّلة عبر حركات عكسية مُدققة. يتطلب ذلك أن تكون الكمية المنتجة ما زالت في المخزون." confirmText="عكس الأمر">
                  عكس الأمر (تصحيح)
                </ConfirmButton>
              </ActionForm>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
