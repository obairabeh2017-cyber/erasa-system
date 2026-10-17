import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Badge, Stat } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { formatDate, toDateInput } from "@/lib/dates";
import { PAYMENT_KIND } from "@/lib/labels";
import { toInputDecimal } from "@/lib/money";
import { updateAccountAction } from "../actions";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await prisma.cashAccount.findUnique({ where: { id: Number(id) } });
  if (!a) notFound();
  const payments = await prisma.payment.findMany({
    where: { accountId: a.id },
    include: { customer: true, supplier: true, employee: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  let running = a.openingBalance;
  const rows = payments.map((p) => {
    if (p.status === "POSTED") running += p.direction === "IN" ? p.amount : -p.amount;
    return { p, balance: running };
  });
  return (
    <div className="space-y-5">
      <PageHeader title={`كشف حساب: ${a.name}`} crumbs={[{ label: "الخزينة", href: "/cash" }, { label: a.name }]} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="الرصيد الافتتاحي" value={<Money value={a.openingBalance} />} hint={formatDate(a.openingDate)} />
        <Stat label="الرصيد الحالي" value={<Money value={running} />} tone={running < 0 ? "danger" : "good"} />
      </div>
      <Section title="الحركات">
        {rows.length === 0 ? <p className="text-sm text-stone-500">لا توجد حركات.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>التاريخ</th><th>الرقم</th><th>النوع</th><th>الطرف / البيان</th><th>قبض</th><th>صرف</th><th>الرصيد</th></tr></thead>
              <tbody>
                {rows.slice().reverse().map(({ p, balance }) => (
                  <tr key={p.id} className={p.status === "VOIDED" ? "opacity-50 line-through" : ""}>
                    <td>{formatDate(p.date)}</td>
                    <td><Link href={`/payments/${p.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{p.number}</Link></td>
                    <td>{PAYMENT_KIND[p.kind] ?? p.kind} {p.status === "VOIDED" && <Badge>ملغاة</Badge>}</td>
                    <td className="max-w-xs truncate">{p.customer?.name ?? p.supplier?.name ?? p.employee?.name ?? p.notes ?? "—"}</td>
                    <td>{p.direction === "IN" ? <Money value={p.amount} className="text-emerald-700" /> : ""}</td>
                    <td>{p.direction === "OUT" ? <Money value={p.amount} className="text-red-700" /> : ""}</td>
                    <td><Money value={balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="تعديل الحساب">
        <ActionForm action={updateAccountAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={a.id} />
          <div><label className="label" htmlFor="e-name">الاسم</label><input id="e-name" name="name" className="input" defaultValue={a.name} required /></div>
          <div><label className="label" htmlFor="e-ob">الرصيد الافتتاحي (التعديل يُسجّل في سجل التدقيق)</label><input id="e-ob" name="openingBalance" className="input" inputMode="decimal" dir="ltr" defaultValue={toInputDecimal(a.openingBalance)} /></div>
          <div><label className="label" htmlFor="e-od">تاريخ الرصيد الافتتاحي</label><input id="e-od" name="openingDate" type="date" className="input" defaultValue={toDateInput(a.openingDate)} /></div>
          <div><label className="label" htmlFor="e-notes">ملاحظات</label><input id="e-notes" name="notes" className="input" defaultValue={a.notes ?? ""} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={a.active} className="size-4" /> حساب نشط</label>
          <div className="sm:col-span-2"><SubmitButton>حفظ</SubmitButton></div>
        </ActionForm>
      </Section>
    </div>
  );
}
