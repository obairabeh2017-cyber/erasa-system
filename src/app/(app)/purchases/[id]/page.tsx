import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Qty, StatusBadge, DL, Alert } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { DocForm } from "@/components/doc-form";
import { PaymentFields } from "@/components/payment-fields";
import { PaymentHistory, allocationInclude } from "@/components/payment-history";
import { sp, type SearchParams } from "@/components/table";
import { accountOptions, itemOptions, supplierOptions } from "@/lib/options";
import { formatDate, formatDateTime, todayInput } from "@/lib/dates";
import { lineAmount, toInputDecimal } from "@/lib/money";
import { purchaseOutstanding } from "@/lib/services/payments";
import { deletePurchaseDraftAction, payPurchaseAction, postPurchaseAction, savePurchaseAction, voidPurchaseAction } from "../actions";

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const postError = sp(await searchParams, "postError");
  const p = await prisma.purchase.findUnique({
    where: { id: Number(id) },
    include: { supplier: true, items: { include: { item: { include: { unit: true } } } }, allocations: { include: allocationInclude, orderBy: { id: "asc" } } },
  });
  if (!p) notFound();
  const accounts = await accountOptions();
  const outstanding = p.status === "POSTED" ? await purchaseOutstanding(prisma, p.id) : 0;
  const paid = p.total - outstanding;

  if (p.status === "DRAFT") {
    const [suppliers, items] = await Promise.all([supplierOptions(), itemOptions(undefined, { priceFrom: "cost" })]);
    return (
      <div className="space-y-5">
        <PageHeader title={`فاتورة شراء ${p.number}`} crumbs={[{ label: "المشتريات", href: "/purchases" }, { label: p.number }]} subtitle={<StatusBadge status={p.status} />} />
        {postError && <Alert tone="danger">حُفظت المسودة لكن تعذر الترحيل: {postError}</Alert>}
        <Section title="تعديل المسودة">
          <DocForm
            action={savePurchaseAction}
            kind="purchase"
            parties={suppliers}
            options={items}
            accounts={accounts}
            doc={{ id: p.id, partyId: p.supplierId, date: p.date, dueDate: p.dueDate, discount: p.discount, notes: p.notes, supplierInvoiceNo: p.supplierInvoiceNo, lines: p.items.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.unitCost, discount: l.lineDiscount })) }}
          />
        </Section>
        <Section title="ترحيل أو حذف">
          <ActionForm action={postPurchaseAction} className="space-y-3">
            <input type="hidden" name="id" value={p.id} />
            <PaymentFields accounts={accounts} amountLabel="المبلغ المدفوع الآن (اختياري)" prefix="post" />
            <ConfirmButton className="btn btn-primary" title="ترحيل فاتورة الشراء" message="سيُضاف كل صنف إلى المخزون بتكلفته، ويُسجّل المتبقي ديناً للمورّد. الترحيل نهائي ولا يُصحح إلا بالإلغاء." confirmText="ترحيل">ترحيل الفاتورة (المحفوظة)</ConfirmButton>
          </ActionForm>
          <ActionForm action={deletePurchaseDraftAction} className="mt-4">
            <input type="hidden" name="id" value={p.id} />
            <ConfirmButton title="حذف المسودة" message="ستُحذف هذه المسودة نهائياً (لم تؤثر على المخزون)." confirmText="حذف">حذف المسودة</ConfirmButton>
          </ActionForm>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={`فاتورة شراء ${p.number}`} crumbs={[{ label: "المشتريات", href: "/purchases" }, { label: p.number }]} subtitle={<StatusBadge status={p.status} />} />
      <Section title="البيانات">
        <DL
          items={[
            ["المورّد", <Link key="s" href={`/suppliers/${p.supplierId}`} className="text-brand-700 hover:underline">{p.supplier.name}</Link>],
            ["رقم فاتورة المورّد", p.supplierInvoiceNo ?? "—"],
            ["التاريخ", formatDate(p.date)],
            ["الاستحقاق", formatDate(p.dueDate)],
            ["تاريخ الترحيل", formatDateTime(p.postedAt)],
            ...(p.voidedAt ? ([["تاريخ الإلغاء", formatDateTime(p.voidedAt)]] as [string, React.ReactNode][]) : []),
            ["المجموع قبل الخصومات", <Money key="st" value={p.subtotal} />],
            ["الخصومات", <Money key="d" value={p.subtotal - p.total} />],
            ["الإجمالي", <Money key="t" value={p.total} className="font-bold" />],
            ...(p.status === "POSTED"
              ? ([
                  ["المدفوع", <Money key="pd" value={paid} />],
                  ["المتبقي للمورّد", <Money key="o" value={outstanding} className={outstanding > 0 ? "font-bold text-red-700" : ""} />],
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />
        {p.notes && <p className="mt-3 text-sm text-stone-600">ملاحظات: {p.notes}</p>}
      </Section>
      <Section title="الأصناف">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة</th><th>القيمة</th><th>خصم السطر</th><th>الصافي</th><th>القيمة المضافة للمخزون</th></tr></thead>
            <tbody>
              {p.items.map((l) => (
                <tr key={l.id}>
                  <td>{l.item.name}</td>
                  <td><Qty value={l.qty} unit={l.item.unit.name} /></td>
                  <td><Money value={l.unitCost} /></td>
                  <td><Money value={lineAmount(l.qty, l.unitCost)} /></td>
                  <td><Money value={l.lineDiscount} /></td>
                  <td><Money value={l.lineTotal} /></td>
                  <td><Money value={l.stockValue} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="سجل المدفوعات">
        <PaymentHistory allocations={p.allocations} />
        {p.status === "POSTED" && outstanding > 0 && (
          <ActionForm action={payPurchaseAction} className="mt-4 space-y-3" resetOnSuccess>
            <h3 className="text-sm font-semibold">تسجيل دفعة للمورّد</h3>
            <input type="hidden" name="id" value={p.id} />
            <PaymentFields accounts={accounts} defaultAmount={toInputDecimal(outstanding)} requireAmount />
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="label" htmlFor="pay-date">التاريخ</label><input id="pay-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
              <SubmitButton>تسجيل الدفعة</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Section>
      {p.status === "POSTED" && (
        <Section title="تصحيح">
          <ActionForm action={voidPurchaseAction}>
            <input type="hidden" name="id" value={p.id} />
            <ConfirmButton requireReason title="إلغاء فاتورة الشراء" message="ستُسجّل حركات مخزون عكسية لإخراج الأصناف. يجب ألا تكون هناك دفعات قائمة وأن تكون الكميات ما زالت في المخزون." confirmText="إلغاء الفاتورة">إلغاء الفاتورة</ConfirmButton>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
