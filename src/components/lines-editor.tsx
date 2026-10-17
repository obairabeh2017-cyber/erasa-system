"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatQty, lineAmount, parseDecimal } from "@/lib/money";

export type LineOption = { id: number; label: string; unit: string; price?: number; stock?: number };

type PriceLine = { key: number; itemId: string; qty: string; price: string; discount: string };
type RecipeLine = { key: number; materialId: string; qty: string; waste: string };
type ProdLine = { key: number; materialId: string; required: number; actualQty: string };

let seq = 1;
const k = () => seq++;
const dec = (s: string) => parseDecimal(s, 3) ?? 0;
const toInput = (n: number) => formatQty(n).replace(/,/g, "");

function ItemSelect({ value, onChange, options, label, idx }: { value: string; onChange: (v: string) => void; options: LineOption[]; label: string; idx: number }) {
  return (
    <select aria-label={`${label} ${idx + 1}`} className="input min-w-44" value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">— اختر —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
          {o.stock !== undefined ? ` (المتوفر: ${formatQty(o.stock)} ${o.unit})` : ""}
        </option>
      ))}
    </select>
  );
}

/** أسطر فاتورة بيع أو شراء: الصنف، الكمية، السعر، الخصم، الإجمالي. */
export function PriceLinesEditor({
  options,
  initial = [],
  initialDiscount = "",
  priceLabel,
  itemLabel = "الصنف",
}: {
  options: LineOption[];
  initial?: { itemId: number; qty: number; price: number; discount: number }[];
  initialDiscount?: string;
  priceLabel: string;
  itemLabel?: string;
}) {
  const [lines, setLines] = useState<PriceLine[]>(() =>
    initial.length
      ? initial.map((l) => ({ key: k(), itemId: String(l.itemId), qty: toInput(l.qty), price: toInput(l.price), discount: l.discount ? toInput(l.discount) : "" }))
      : [{ key: k(), itemId: "", qty: "1", price: "", discount: "" }],
  );
  const [discount, setDiscount] = useState(initialDiscount);
  const optMap = useMemo(() => new Map(options.map((o) => [String(o.id), o])), [options]);

  const update = (key: number, patch: Partial<PriceLine>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (patch.itemId !== undefined && !l.price) {
          const o = optMap.get(patch.itemId);
          if (o?.price) next.price = toInput(o.price);
        }
        return next;
      }),
    );

  const totals = lines.map((l) => lineAmount(dec(l.qty), dec(l.price)) - dec(l.discount));
  const subtotal = totals.reduce((a, b) => a + b, 0);
  const total = subtotal - dec(discount);
  const payload = JSON.stringify(lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, discount: l.discount })));

  return (
    <div>
      <input type="hidden" name="lines" value={payload} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{itemLabel}</th>
              <th>الكمية</th>
              <th>{priceLabel}</th>
              <th>خصم السطر</th>
              <th>الإجمالي</th>
              <th><span className="sr-only">حذف</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const o = optMap.get(l.itemId);
              return (
                <tr key={l.key}>
                  <td><ItemSelect value={l.itemId} onChange={(v) => update(l.key, { itemId: v })} options={options} label={itemLabel} idx={i} /></td>
                  <td>
                    <div className="flex items-center gap-1">
                      <input aria-label={`الكمية ${i + 1}`} className="input w-24" inputMode="decimal" dir="ltr" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                      <span className="text-xs text-stone-500">{o?.unit}</span>
                    </div>
                  </td>
                  <td><input aria-label={`${priceLabel} ${i + 1}`} className="input w-28" inputMode="decimal" dir="ltr" value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} /></td>
                  <td><input aria-label={`خصم السطر ${i + 1}`} className="input w-24" inputMode="decimal" dir="ltr" value={l.discount} placeholder="0" onChange={(e) => update(l.key, { discount: e.target.value })} /></td>
                  <td className="num font-medium">{formatMoney(totals[i])}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm text-red-700" aria-label={`حذف السطر ${i + 1}`} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: k(), itemId: "", qty: "1", price: "", discount: "" }])}>+ إضافة سطر</button>
        <div className="w-full max-w-xs space-y-2 text-sm">
          <div className="flex justify-between"><span>المجموع بعد خصم الأسطر</span><span className="num">{formatMoney(subtotal)}</span></div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="discount">خصم الفاتورة</label>
            <input id="discount" name="discount" className="input w-32" inputMode="decimal" dir="ltr" value={discount} placeholder="0" onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-bold"><span>الإجمالي</span><span className="num">{formatMoney(total)}</span></div>
        </div>
      </div>
    </div>
  );
}

/** أسطر الوصفة: المادة، الكمية، نسبة الهدر. */
export function RecipeLinesEditor({ options, initial = [] }: { options: LineOption[]; initial?: { materialId: number; qty: number; wasteBp: number }[] }) {
  const [lines, setLines] = useState<RecipeLine[]>(() =>
    initial.length
      ? initial.map((l) => ({ key: k(), materialId: String(l.materialId), qty: toInput(l.qty), waste: l.wasteBp ? formatQty(l.wasteBp * 10) : "" }))
      : [{ key: k(), materialId: "", qty: "", waste: "" }],
  );
  const optMap = new Map(options.map((o) => [String(o.id), o]));
  const update = (key: number, patch: Partial<RecipeLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = JSON.stringify(lines.map((l) => ({ materialId: l.materialId, qty: l.qty, waste: l.waste })));
  return (
    <div>
      <input type="hidden" name="lines" value={payload} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>المادة الخام</th><th>الكمية</th><th>نسبة الهدر %</th><th><span className="sr-only">حذف</span></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td><ItemSelect value={l.materialId} onChange={(v) => update(l.key, { materialId: v })} options={options} label="المادة" idx={i} /></td>
                <td>
                  <div className="flex items-center gap-1">
                    <input aria-label={`الكمية ${i + 1}`} className="input w-24" inputMode="decimal" dir="ltr" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                    <span className="text-xs text-stone-500">{optMap.get(l.materialId)?.unit}</span>
                  </div>
                </td>
                <td><input aria-label={`الهدر ${i + 1}`} className="input w-20" inputMode="decimal" dir="ltr" placeholder="0" value={l.waste} onChange={(e) => update(l.key, { waste: e.target.value })} /></td>
                <td><button type="button" className="btn btn-ghost btn-sm text-red-700" aria-label={`حذف السطر ${i + 1}`} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setLines((ls) => [...ls, { key: k(), materialId: "", qty: "", waste: "" }])}>+ إضافة مادة</button>
    </div>
  );
}

/** المواد الفعلية لأمر الإنتاج: المطلوب حسب الوصفة، والكمية الفعلية المستهلكة. */
export function ProductionMaterialsEditor({ options, initial }: { options: LineOption[]; initial: { materialId: number; requiredQty: number; actualQty: number }[] }) {
  const [lines, setLines] = useState<ProdLine[]>(() =>
    initial.map((l) => ({ key: k(), materialId: String(l.materialId), required: l.requiredQty, actualQty: toInput(l.actualQty) })),
  );
  const optMap = new Map(options.map((o) => [String(o.id), o]));
  const update = (key: number, patch: Partial<ProdLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = JSON.stringify(lines.filter((l) => l.materialId).map((l) => ({ materialId: l.materialId, actualQty: l.actualQty })));
  return (
    <div>
      <input type="hidden" name="materials" value={payload} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>المادة</th><th>المطلوب حسب الوصفة</th><th>المستهلك فعلياً</th><th>المتوفر</th><th><span className="sr-only">حذف</span></th></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const o = optMap.get(l.materialId);
              const short = o?.stock !== undefined && dec(l.actualQty) > o.stock;
              return (
                <tr key={l.key} className={short ? "bg-red-50" : ""}>
                  <td><ItemSelect value={l.materialId} onChange={(v) => update(l.key, { materialId: v })} options={options} label="المادة" idx={i} /></td>
                  <td className="num">{l.required ? `${formatQty(l.required)} ${o?.unit ?? ""}` : "—"}</td>
                  <td><input aria-label={`المستهلك فعلياً ${i + 1}`} className="input w-28" inputMode="decimal" dir="ltr" value={l.actualQty} onChange={(e) => update(l.key, { actualQty: e.target.value })} /></td>
                  <td className={short ? "font-semibold text-red-700" : ""}>{o?.stock !== undefined ? `${formatQty(o.stock)} ${o.unit}` : "—"}{short ? " — غير كافٍ" : ""}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm text-red-700" aria-label={`حذف السطر ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setLines((ls) => [...ls, { key: k(), materialId: "", required: 0, actualQty: "" }])}>+ مادة إضافية</button>
    </div>
  );
}
