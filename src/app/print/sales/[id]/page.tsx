import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth/owner";
import { PrintButton } from "@/components/forms";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatQty, lineAmount, sum } from "@/lib/money";
import { saleOutstanding } from "@/lib/services/payments";

export const dynamic = "force-dynamic";
export const metadata = { title: "طباعة فاتورة" };

/** فاتورة قابلة للطباعة والحفظ PDF عبر نافذة الطباعة في المتصفح (بدون القائمة الجانبية). */
export default async function PrintSalePage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const [s, settings] = await Promise.all([
    prisma.sale.findUnique({ where: { id: Number(id) }, include: { customer: true, items: { include: { item: { include: { unit: true } } } }, returns: { where: { status: "POSTED" } } } }),
    prisma.appSettings.findUnique({ where: { id: 1 } }),
  ]);
  if (!s) notFound();
  const outstanding = s.status === "POSTED" ? await saleOutstanding(prisma, s.id) : 0;
  const returns = sum(s.returns.map((r) => r.total));
  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-sm text-black print:p-0">
      <div className="no-print mb-4 flex justify-between">
        <PrintButton />
        <a href={`/sales/${s.id}`} className="btn btn-ghost">رجوع</a>
      </div>
      <header className="mb-6 flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <h1 className="text-2xl font-bold">{settings?.companyName}</h1>
          {settings?.companyAddress && <div>{settings.companyAddress}</div>}
          {settings?.companyPhone && <div dir="ltr" className="text-end">{settings.companyPhone}</div>}
        </div>
        <div className="text-end">
          <div className="text-xl font-bold">فاتورة بيع</div>
          <div className="font-mono" dir="ltr">{s.number}</div>
          <div>التاريخ: {formatDate(s.date)}</div>
          {s.dueDate && <div>الاستحقاق: {formatDate(s.dueDate)}</div>}
          {s.status !== "POSTED" && <div className="mt-1 font-bold text-red-700">{s.status === "DRAFT" ? "مسودة — غير مُرحّلة" : "ملغاة"}</div>}
        </div>
      </header>
      <div className="mb-4"><span className="font-semibold">الزبون: </span>{s.customer?.name ?? "زبون نقدي"} {s.customer?.phone && <span dir="ltr">({s.customer.phone})</span>}</div>
      <table className="mb-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="p-1.5 text-start">#</th><th className="p-1.5 text-start">المنتج</th><th className="p-1.5 text-start">الكمية</th><th className="p-1.5 text-start">السعر</th><th className="p-1.5 text-start">الخصم</th><th className="p-1.5 text-start">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {s.items.map((l, i) => (
            <tr key={l.id} className="border-b border-stone-300">
              <td className="p-1.5">{i + 1}</td>
              <td className="p-1.5">{l.item.name}</td>
              <td className="p-1.5 num">{formatQty(l.qty)} {l.item.unit.name}</td>
              <td className="p-1.5 num">{formatMoney(l.unitPrice)}</td>
              <td className="p-1.5 num">{l.lineDiscount ? formatMoney(l.lineDiscount) : "—"}</td>
              <td className="p-1.5 num">{formatMoney(lineAmount(l.qty, l.unitPrice) - l.lineDiscount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ms-auto w-72 space-y-1">
        <Row k="المجموع" v={formatMoney(sum(s.items.map((l) => l.lineTotal)))} />
        {s.discount > 0 && <Row k="خصم الفاتورة" v={formatMoney(s.discount)} />}
        <Row k="الإجمالي" v={formatMoney(s.total)} bold />
        {returns > 0 && <Row k="المرتجعات" v={formatMoney(returns)} />}
        {s.status === "POSTED" && <Row k="المدفوع" v={formatMoney(s.total - returns - outstanding)} />}
        {s.status === "POSTED" && <Row k="المتبقي" v={formatMoney(outstanding)} bold />}
      </div>
      {s.notes && <p className="mt-6">ملاحظات: {s.notes}</p>}
      {settings?.invoiceFooter && <footer className="mt-10 border-t border-stone-400 pt-3 text-center text-xs">{settings.invoiceFooter}</footer>}
    </main>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t border-black pt-1 font-bold" : ""}`}>
      <span>{k}</span><span className="num">{v}</span>
    </div>
  );
}
