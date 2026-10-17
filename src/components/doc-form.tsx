import { ActionForm, SubmitButton } from "@/components/forms";
import { PriceLinesEditor, type LineOption } from "@/components/lines-editor";
import { PaymentFields } from "@/components/payment-fields";
import { toDateInput, todayInput } from "@/lib/dates";
import { toInputDecimal } from "@/lib/money";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState | undefined, fd: FormData) => Promise<ActionState>;

/** نموذج فاتورة (بيع أو شراء) مع حفظ كمسودة أو حفظ وترحيل مباشر. */
export function DocForm({
  action,
  kind,
  parties,
  options,
  accounts,
  doc,
}: {
  action: Action;
  kind: "sale" | "purchase";
  parties: { id: number; name: string }[];
  options: LineOption[];
  accounts: { id: number; name: string }[];
  doc?: {
    id: number;
    partyId: number | null;
    date: Date;
    dueDate: Date | null;
    discount: number;
    notes: string | null;
    supplierInvoiceNo?: string | null;
    lines: { itemId: number; qty: number; price: number; discount: number }[];
  };
}) {
  const isSale = kind === "sale";
  return (
    <ActionForm action={action} className="space-y-5">
      {doc && <input type="hidden" name="id" value={doc.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="partyId">{isSale ? "الزبون" : "المورّد *"}</label>
          <select id="partyId" name="partyId" className="input" defaultValue={doc?.partyId ?? ""} required={!isSale}>
            <option value="">{isSale ? "— زبون نقدي (بدون اسم) —" : "— اختر —"}</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {!isSale && (
          <div>
            <label className="label" htmlFor="supplierInvoiceNo">رقم فاتورة المورّد</label>
            <input id="supplierInvoiceNo" name="supplierInvoiceNo" className="input" defaultValue={doc?.supplierInvoiceNo ?? ""} />
          </div>
        )}
        <div>
          <label className="label" htmlFor="date">التاريخ *</label>
          <input id="date" name="date" type="date" className="input" defaultValue={doc ? toDateInput(doc.date) : todayInput()} required />
        </div>
        <div>
          <label className="label" htmlFor="dueDate">تاريخ الاستحقاق</label>
          <input id="dueDate" name="dueDate" type="date" className="input" defaultValue={doc?.dueDate ? toDateInput(doc.dueDate) : ""} />
        </div>
        <div className={isSale ? "sm:col-span-2 lg:col-span-1" : "sm:col-span-2 lg:col-span-4"}>
          <label className="label" htmlFor="notes">ملاحظات</label>
          <input id="notes" name="notes" className="input" defaultValue={doc?.notes ?? ""} />
        </div>
      </div>
      <PriceLinesEditor
        options={options}
        initial={doc?.lines}
        initialDiscount={doc?.discount ? toInputDecimal(doc.discount) : ""}
        priceLabel={isSale ? "سعر البيع" : "تكلفة الوحدة"}
        itemLabel={isSale ? "المنتج" : "الصنف"}
      />
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-semibold text-stone-700">{isSale ? "المبلغ المستلم عند الترحيل (اختياري)" : "المبلغ المدفوع عند الترحيل (اختياري)"}</legend>
        <PaymentFields accounts={accounts} amountLabel={isSale ? "المبلغ المستلم" : "المبلغ المدفوع"} />
        <p className="mt-2 text-xs text-stone-500">يُستخدم فقط عند «حفظ وترحيل». المتبقي يُسجّل ديناً {isSale ? "على الزبون" : "للمورّد"}.</p>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="draft" className="btn btn-secondary">حفظ كمسودة</SubmitButton>
        <SubmitButton name="intent" value="post">حفظ وترحيل</SubmitButton>
      </div>
      <p className="text-xs text-stone-500">المسودة لا تؤثر على المخزون أو الديون. الترحيل {isSale ? "يخصم المنتجات من المخزون ويسجل دين الزبون" : "يضيف الأصناف للمخزون ويسجل دين المورّد"}.</p>
    </ActionForm>
  );
}
