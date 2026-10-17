import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, DL, Badge } from "@/components/ui";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { formatDate, formatDateTime } from "@/lib/dates";
import { DIRECTION, PAYMENT_KIND, PAYMENT_METHOD, EMP_TXN } from "@/lib/labels";
import { sum } from "@/lib/money";
import { expenseOutstanding, otherIncomeOutstanding, purchaseOutstanding, saleOutstanding } from "@/lib/services/payments";
import { allocateAction, removeAllocationAction, voidPaymentAction } from "../actions";

type OpenDoc = { key: string; label: string; date: Date; outstanding: number; href: string };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.payment.findUnique({
    where: { id: Number(id) },
    include: {
      account: true, customer: true, supplier: true, employee: true,
      allocations: { include: { sale: true, purchase: true, expense: true, otherIncome: true, employeeTransaction: true } },
    },
  });
  if (!p) notFound();
  const allocated = sum(p.allocations.map((a) => a.amount));
  const unallocated = p.kind === "TRANSFER" ? 0 : p.amount - allocated;

  // المستندات المفتوحة المتوافقة مع الدفعة (نفس الطرف ونفس الاتجاه)
  const open: OpenDoc[] = [];
  if (p.status === "POSTED" && unallocated > 0) {
    if (p.direction === "IN" && p.customerId) {
      for (const s of await prisma.sale.findMany({ where: { customerId: p.customerId, status: "POSTED" }, orderBy: { date: "asc" } })) {
        const o = await saleOutstanding(prisma, s.id);
        if (o > 0) open.push({ key: `alloc_sale_${s.id}`, label: `فاتورة بيع ${s.number}`, date: s.date, outstanding: o, href: `/sales/${s.id}` });
      }
    }
    if (p.direction === "OUT" && p.supplierId) {
      for (const d of await prisma.purchase.findMany({ where: { supplierId: p.supplierId, status: "POSTED" }, orderBy: { date: "asc" } })) {
        const o = await purchaseOutstanding(prisma, d.id);
        if (o > 0) open.push({ key: `alloc_purchase_${d.id}`, label: `فاتورة شراء ${d.number}`, date: d.date, outstanding: o, href: `/purchases/${d.id}` });
      }
    }
    if (p.direction === "OUT" && !p.supplierId && !p.customerId && !p.employeeId) {
      for (const e of await prisma.expense.findMany({ where: { status: "POSTED", paidByEmployeeId: null }, orderBy: { date: "asc" } })) {
        const o = await expenseOutstanding(prisma, e.id);
        if (o > 0) open.push({ key: `alloc_expense_${e.id}`, label: `مصروف ${e.number}: ${e.description}`, date: e.date, outstanding: o, href: `/expenses/${e.id}` });
      }
    }
    if (p.direction === "IN" && !p.customerId && !p.supplierId && !p.employeeId) {
      for (const e of await prisma.otherIncome.findMany({ where: { status: "POSTED" }, orderBy: { date: "asc" } })) {
        const o = await otherIncomeOutstanding(prisma, e.id);
        if (o > 0) open.push({ key: `alloc_otherIncome_${e.id}`, label: `إيراد ${e.number}: ${e.description}`, date: e.date, outstanding: o, href: `/income` });
      }
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={`${DIRECTION[p.direction]} ${p.number}`} crumbs={[{ label: "المدفوعات", href: "/payments" }, { label: p.number }]} subtitle={p.status === "VOIDED" ? <Badge>ملغاة</Badge> : <Badge tone="green">مُرحّلة</Badge>} />
      <Section title="البيانات">
        <DL
          items={[
            ["الاتجاه", DIRECTION[p.direction]],
            ["النوع", PAYMENT_KIND[p.kind] ?? p.kind],
            ["التاريخ", formatDate(p.date)],
            ["الحساب", <Link key="a" href={`/cash/${p.accountId}`} className="text-brand-700 hover:underline">{p.account.name}</Link>],
            ["الطريقة", PAYMENT_METHOD[p.method] ?? p.method],
            ["المرجع", p.reference ?? "—"],
            ["الطرف", p.customer?.name ?? p.supplier?.name ?? p.employee?.name ?? "—"],
            ["المبلغ", <Money key="m" value={p.amount} className="font-bold" />],
            ["المخصص", <Money key="al" value={allocated} />],
            ["غير المخصص", <Money key="un" value={unallocated} />],
            ["أُنشئت", formatDateTime(p.createdAt)],
            ...(p.voidedAt ? ([["أُلغيت", formatDateTime(p.voidedAt)]] as [string, React.ReactNode][]) : []),
          ]}
        />
        {p.notes && <p className="mt-3 text-sm text-stone-600">ملاحظات: {p.notes}</p>}
      </Section>

      <Section title="التخصيصات">
        {p.allocations.length === 0 ? <p className="text-sm text-stone-500">لا توجد تخصيصات.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>المستند</th><th>المبلغ</th><th></th></tr></thead>
              <tbody>
                {p.allocations.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.sale && <Link className="text-brand-700 hover:underline" href={`/sales/${a.sale.id}`}>فاتورة بيع {a.sale.number}</Link>}
                      {a.purchase && <Link className="text-brand-700 hover:underline" href={`/purchases/${a.purchase.id}`}>فاتورة شراء {a.purchase.number}</Link>}
                      {a.expense && <Link className="text-brand-700 hover:underline" href={`/expenses/${a.expense.id}`}>مصروف {a.expense.number}</Link>}
                      {a.otherIncome && <span>إيراد {a.otherIncome.number}</span>}
                      {a.employeeTransaction && <Link className="text-brand-700 hover:underline" href={`/employees/${a.employeeTransaction.employeeId}`}>{EMP_TXN[a.employeeTransaction.type]}</Link>}
                    </td>
                    <td><Money value={a.amount} /></td>
                    <td>
                      {p.status === "POSTED" && !a.employeeTransactionId && (
                        <ActionForm action={removeAllocationAction}>
                          <input type="hidden" name="allocationId" value={a.id} />
                          <ConfirmButton className="btn btn-secondary btn-sm" title="فك التخصيص" message="سيعود المبلغ غير مخصص ويزيد المتبقي على المستند." confirmText="فك">فك التخصيص</ConfirmButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open.length > 0 && (
          <ActionForm action={allocateAction} className="mt-4 space-y-3">
            <h3 className="text-sm font-semibold">تخصيص المبلغ غير المخصص (<Money value={unallocated} />)</h3>
            <input type="hidden" name="id" value={p.id} />
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>المستند</th><th>التاريخ</th><th>المتبقي</th><th>مبلغ التخصيص</th></tr></thead>
                <tbody>
                  {open.map((d) => (
                    <tr key={d.key}>
                      <td><Link href={d.href} className="text-brand-700 hover:underline">{d.label}</Link></td>
                      <td>{formatDate(d.date)}</td>
                      <td><Money value={d.outstanding} /></td>
                      <td><input aria-label={`تخصيص ${d.label}`} name={d.key} className="input w-32" inputMode="decimal" dir="ltr" placeholder="0" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubmitButton>حفظ التخصيص</SubmitButton>
          </ActionForm>
        )}
      </Section>

      {p.status === "POSTED" && (
        <Section title="إلغاء الدفعة">
          <p className="mb-3 text-sm text-stone-600">الإلغاء يبقي السجل للتاريخ لكنه يستبعد المبلغ من الأرصدة ويعيد المتبقي على المستندات المخصصة.{p.kind === "TRANSFER" && " سيتم إلغاء طرفي التحويل معاً."}{p.kind === "EMPLOYEE" && " ستُلغى حركة الموظف المرتبطة أيضاً."}</p>
          <ActionForm action={voidPaymentAction}>
            <input type="hidden" name="id" value={p.id} />
            <ConfirmButton requireReason title="إلغاء الدفعة" message="هل أنت متأكد من إلغاء هذه الدفعة؟" confirmText="إلغاء الدفعة">إلغاء الدفعة</ConfirmButton>
          </ActionForm>
        </Section>
      )}
    </div>
  );
}
