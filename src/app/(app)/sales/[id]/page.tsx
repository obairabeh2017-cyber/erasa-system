import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Qty, StatusBadge, DL, Alert, Badge } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { DocForm } from "@/components/doc-form";
import { PaymentFields } from "@/components/payment-fields";
import { PaymentHistory, allocationInclude } from "@/components/payment-history";
import { sp, type SearchParams } from "@/components/table";
import { accountOptions, customerOptions, itemOptions } from "@/lib/options";
import { formatDate, formatDateTime, todayInput } from "@/lib/dates";
import { lineAmount, sum, toInputDecimal } from "@/lib/money";
import { saleOutstanding } from "@/lib/services/payments";
import { deleteSaleDraftAction, postSaleAction, receiveSaleAction, refundSaleAction, saleReturnAction, saveSaleAction, voidSaleAction } from "../actions";

export default async function SalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const postError = sp(await searchParams, "postError");
  const s = await prisma.sale.findUnique({
    where: { id: Number(id) },
    include: {
      customer: true,
      items: { include: { item: { include: { unit: true } }, returnItems: { include: { saleReturn: true } } } },
      returns: { include: { items: { include: { saleItem: { include: { item: true } } } } }, orderBy: { id: "asc" } },
      allocations: { include: allocationInclude, orderBy: { id: "asc" } },
    },
  });
  if (!s) notFound();
  const accounts = await accountOptions();

  if (s.status === "DRAFT") {
    const [customers, items] = await Promise.all([customerOptions(), itemOptions("FINISHED", { includeStock: true, priceFrom: "sale" })]);
    return (
      <div className="space-y-5">
        <PageHeader title={`فاتورة بيع ${s.number}`} crumbs={[{ label: "المبيعات", href: "/sales" }, { label: s.number }]} subtitle={<StatusBadge status={s.status} />} />
        {postError && <Alert tone="danger">حُفظت المسودة لكن تعذر الترحيل: {postError}</Alert>}
        <Section title="تعديل المسودة">
          <DocForm
            action={saveSaleAction}
            kind="sale"
            parties={customers}
            options={items}
            accounts={accounts}
            doc={{ id: s.id, partyId: s.customerId, date: s.date, dueDate: s.dueDate, discount: s.discount, notes: s.notes, lines: s.items.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.unitPrice, discount: l.lineDiscount })) }}
          />
        </Section>
        <Section title="ترحيل أو حذف">
          <ActionForm action={postSaleAction} className="space-y-3">
            <input type="hidden" name="id" value={s.id} />
            <PaymentFields accounts={accounts} amountLabel="المبلغ المستلم الآن (اختياري)" prefix="post" />
            <ConfirmButton className="btn btn-primary" title="ترحيل فاتورة البيع" message="ستُخصم المنتجات من المخزون وتُحفظ تكلفة المواد الحالية لها، ويُسجّل المتبقي ديناً على الزبون." confirmText="ترحيل">ترحيل الفاتورة (المحفوظة)</ConfirmButton>
          </ActionForm>
          <ActionForm action={deleteSaleDraftAction} className="mt-4">
            <input type="hidden" name="id" value={s.id} />
            <ConfirmButton title="حذف المسودة" message="ستُحذف هذه المسودة نهائياً." confirmText="حذف">حذف المسودة</ConfirmButton>
          </ActionForm>
        </Section>
      </div>
    );
  }

  const outstanding = s.status === "POSTED" ? await saleOutstanding(prisma, s.id) : 0;
  const returnsTotal = sum(s.returns.filter((r) => r.status === "POSTED").map((r) => r.total));
  const received = sum(s.allocations.filter((a) => a.payment.status === "POSTED").map((a) => (a.payment.direction === "IN" ? a.amount : -a.amount)));
  const returnable = s.items.map((l) => ({ line: l, left: l.qty - sum(l.returnItems.filter((r) => r.saleReturn.status === "POSTED").map((r) => r.qty)) }));
  const canReturn = s.status === "POSTED" && returnable.some((r) => r.left > 0);
  const net = s.total - returnsTotal;
  const grossProfit = net - (s.costTotal - sum(s.returns.filter((r) => r.status === "POSTED").map((r) => r.costTotal)));

  return (
    <div className="space-y-5">
      <PageHeader
        title={`فاتورة بيع ${s.number}`}
        crumbs={[{ label: "المبيعات", href: "/sales" }, { label: s.number }]}
        subtitle={<StatusBadge status={s.status} />}
        actions={<Link href={`/print/sales/${s.id}`} className="btn btn-secondary" target="_blank">🖨️ طباعة الفاتورة</Link>}
      />
      <Section title="البيانات">
        <DL
          items={[
            ["الزبون", s.customer ? <Link key="c" className="text-brand-700 hover:underline" href={`/customers/${s.customerId}`}>{s.customer.name}</Link> : "زبون نقدي"],
            ["التاريخ", formatDate(s.date)],
            ["الاستحقاق", formatDate(s.dueDate)],
            ["تاريخ الترحيل", formatDateTime(s.postedAt)],
            ...(s.voidedAt ? ([["تاريخ الإلغاء", formatDateTime(s.voidedAt)]] as [string, React.ReactNode][]) : []),
            ["المجموع قبل الخصومات", <Money key="st" value={s.subtotal} />],
            ["الخصومات", <Money key="d" value={s.subtotal - s.total} />],
            ["إجمالي الفاتورة", <Money key="t" value={s.total} className="font-bold" />],
            ["المرتجعات", <Money key="r" value={returnsTotal} />],
            ...(s.status === "POSTED"
              ? ([
                  ["المستلم (صافي)", <Money key="rc" value={received} />],
                  [outstanding >= 0 ? "المتبقي على الزبون" : "مبلغ زائد مستحق للزبون", <Money key="o" value={Math.abs(outstanding)} className={outstanding !== 0 ? "font-bold text-red-700" : ""} />],
                  ["تكلفة المواد (لقطة عند الترحيل)", <Money key="ct" value={s.costTotal} />],
                  ["إجمالي الربح التقديري", <Money key="gp" value={grossProfit} colored />],
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />
        {s.notes && <p className="mt-3 text-sm text-stone-600">ملاحظات: {s.notes}</p>}
        <p className="mt-3 text-xs text-stone-500">إجمالي الربح التقديري = صافي المبيعات − تكلفة المواد الخام فقط؛ لا يشمل العمالة والتكاليف غير المباشرة.</p>
      </Section>
      <Section title="المنتجات">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>القيمة</th><th>الخصم</th><th>الصافي</th><th>تكلفة المواد للوحدة</th><th>المرتجع</th></tr></thead>
            <tbody>
              {returnable.map(({ line: l, left }) => (
                <tr key={l.id}>
                  <td>{l.item.name}</td>
                  <td><Qty value={l.qty} unit={l.item.unit.name} /></td>
                  <td><Money value={l.unitPrice} /></td>
                  <td><Money value={lineAmount(l.qty, l.unitPrice)} /></td>
                  <td><Money value={l.lineDiscount} /></td>
                  <td><Money value={l.lineTotal} /></td>
                  <td><Money value={l.unitCost} /></td>
                  <td>{l.qty - left > 0 ? <Qty value={l.qty - left} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="المقبوضات والمردودات النقدية">
        <PaymentHistory allocations={s.allocations} />
        {s.status === "POSTED" && outstanding > 0 && (
          <ActionForm action={receiveSaleAction} className="mt-4 space-y-3" resetOnSuccess>
            <h3 className="text-sm font-semibold">استلام دفعة على هذه الفاتورة</h3>
            <input type="hidden" name="id" value={s.id} />
            <PaymentFields accounts={accounts} defaultAmount={toInputDecimal(outstanding)} requireAmount />
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="label" htmlFor="rc-date">التاريخ</label><input id="rc-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
              <SubmitButton>تسجيل المبلغ المستلم</SubmitButton>
            </div>
          </ActionForm>
        )}
        {s.status === "POSTED" && outstanding < 0 && (
          <ActionForm action={refundSaleAction} className="mt-4 space-y-3">
            <h3 className="text-sm font-semibold">رد المبلغ الزائد للزبون (<Money value={-outstanding} />)</h3>
            <input type="hidden" name="id" value={s.id} />
            <PaymentFields accounts={accounts} showAmount={false} prefix="rf" />
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="label" htmlFor="rf-date">التاريخ</label><input id="rf-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
              <SubmitButton>تسجيل رد المبلغ</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Section>

      {(s.returns.length > 0 || canReturn) && (
        <Section title="المرتجعات (إشعارات دائنة)">
          {s.returns.length > 0 && (
            <ul className="mb-4 space-y-2 text-sm">
              {s.returns.map((r) => (
                <li key={r.id} className="rounded-lg border border-stone-200 p-2">
                  <span className="font-mono" dir="ltr">{r.number}</span> — {formatDate(r.date)} — <Money value={r.total} /> {r.status !== "POSTED" && <Badge>ملغى</Badge>}
                  <div className="text-stone-500">{r.items.map((i) => `${i.saleItem.item.name} × ${toInputDecimal(i.qty)}`).join("، ")}</div>
                </li>
              ))}
            </ul>
          )}
          {canReturn && (
            <ActionForm action={saleReturnAction} className="space-y-3">
              <input type="hidden" name="id" value={s.id} />
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>المنتج</th><th>المتاح للإرجاع</th><th>الكمية المرتجعة</th></tr></thead>
                  <tbody>
                    {returnable.filter((r) => r.left > 0).map(({ line: l, left }) => (
                      <tr key={l.id}>
                        <td>{l.item.name}</td>
                        <td><Qty value={left} unit={l.item.unit.name} /></td>
                        <td><input aria-label={`كمية مرتجعة ${l.item.name}`} name={`ret_${l.id}`} className="input w-28" inputMode="decimal" dir="ltr" placeholder="0" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="ret-date">تاريخ المرتجع</label><input id="ret-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
                <div><label className="label" htmlFor="ret-notes">السبب / ملاحظات</label><input id="ret-notes" name="notes" className="input" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="refund" className="size-4" /> إن أصبح المدفوع أكثر من المستحق، رُدّ الفرق نقداً من الحساب التالي:</label>
              <PaymentFields accounts={accounts} showAmount={false} prefix="ret" />
              <ConfirmButton className="btn btn-primary" title="تسجيل مرتجع" message="ستُعاد الكميات للمخزون بتكلفتها الأصلية ويُخفّض رصيد الفاتورة بقيمتها الصافية." confirmText="تسجيل المرتجع">تسجيل المرتجع</ConfirmButton>
            </ActionForm>
          )}
        </Section>
      )}

      {s.status === "POSTED" && (
        <Section title="تصحيح">
          <ActionForm action={voidSaleAction}>
            <input type="hidden" name="id" value={s.id} />
            <ConfirmButton requireReason title="إلغاء فاتورة البيع" message="ستُعاد المنتجات للمخزون بتكلفتها المسجّلة. يجب ألا توجد مقبوضات أو مرتجعات على الفاتورة (ألغِ الدفعات أولاً)." confirmText="إلغاء الفاتورة">إلغاء الفاتورة</ConfirmButton>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
