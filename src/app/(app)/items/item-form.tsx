import type { Item } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { toInputDecimal } from "@/lib/money";
import { todayInput } from "@/lib/dates";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState | undefined, fd: FormData) => Promise<ActionState>;

export function ItemForm({
  action,
  item,
  units,
  categories,
  defaultType = "RAW",
}: {
  action: Action;
  item?: Item;
  units: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  defaultType?: string;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor="sku">رمز الصنف (SKU) *</label>
          <input id="sku" name="sku" className="input" dir="ltr" required defaultValue={item?.sku} maxLength={40} />
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor="name">الاسم بالعربية *</label>
          <input id="name" name="name" className="input" required defaultValue={item?.name} />
        </div>
        <div>
          <label className="label" htmlFor="type">النوع *</label>
          <select id="type" name="type" className="input" defaultValue={item?.type ?? defaultType}>
            <option value="RAW">مادة خام</option>
            <option value="FINISHED">منتج تام (أثاث)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="categoryId">الفئة</label>
          <select id="categoryId" name="categoryId" className="input" defaultValue={item?.categoryId ?? ""}>
            <option value="">— بدون —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="unitId">وحدة القياس *</label>
          <select id="unitId" name="unitId" className="input" defaultValue={item?.unitId ?? units[0]?.id} required>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="minStock">الحد الأدنى للمخزون</label>
          <input id="minStock" name="minStock" className="input" inputMode="decimal" dir="ltr" defaultValue={item ? toInputDecimal(item.minStock) : ""} placeholder="0" />
        </div>
        <div>
          <label className="label" htmlFor="salePrice">سعر البيع الافتراضي (د.ل)</label>
          <input id="salePrice" name="salePrice" className="input" inputMode="decimal" dir="ltr" defaultValue={item ? toInputDecimal(item.salePrice) : ""} placeholder="للمنتجات التامة" />
        </div>
        {item && (
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={item.active} className="size-4" /> صنف نشط
            </label>
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="label" htmlFor="notes">ملاحظات</label>
          <textarea id="notes" name="notes" className="input" rows={2} defaultValue={item?.notes ?? ""} />
        </div>
      </div>
      {!item && (
        <fieldset className="rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-sm font-semibold text-stone-700">الرصيد الافتتاحي (اختياري)</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="openingQty">الكمية</label>
              <input id="openingQty" name="openingQty" className="input" inputMode="decimal" dir="ltr" placeholder="0" />
            </div>
            <div>
              <label className="label" htmlFor="openingCost">تكلفة الوحدة (د.ل)</label>
              <input id="openingCost" name="openingCost" className="input" inputMode="decimal" dir="ltr" placeholder="0" />
            </div>
            <div>
              <label className="label" htmlFor="openingDate">التاريخ</label>
              <input id="openingDate" name="openingDate" type="date" className="input" defaultValue={todayInput()} />
            </div>
          </div>
        </fieldset>
      )}
      <SubmitButton>{item ? "حفظ التعديلات" : "إضافة الصنف"}</SubmitButton>
    </ActionForm>
  );
}
