import Link from "next/link";
import { Money, Badge } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { DIRECTION, PAYMENT_METHOD, PAYMENT_KIND } from "@/lib/labels";

type Alloc = {
  id: number;
  amount: number;
  createdAt: Date;
  payment: { id: number; number: string; date: Date; direction: string; kind: string; method: string; reference: string | null; status: string; account: { name: string } };
};

export function PaymentHistory({ allocations }: { allocations: Alloc[] }) {
  if (allocations.length === 0) return <p className="text-sm text-stone-500">لا توجد دفعات مسجّلة.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>رقم الدفعة</th><th>التاريخ</th><th>النوع</th><th>الحساب</th><th>الطريقة</th><th>المرجع</th><th>المبلغ</th><th>الحالة</th></tr></thead>
        <tbody>
          {allocations.map((a) => (
            <tr key={a.id} className={a.payment.status === "VOIDED" ? "opacity-60" : ""}>
              <td><Link href={`/payments/${a.payment.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{a.payment.number}</Link></td>
              <td>{formatDate(a.payment.date)}</td>
              <td>{DIRECTION[a.payment.direction]} — {PAYMENT_KIND[a.payment.kind] ?? a.payment.kind}</td>
              <td>{a.payment.account.name}</td>
              <td>{PAYMENT_METHOD[a.payment.method] ?? a.payment.method}</td>
              <td>{a.payment.reference ?? "—"}</td>
              <td><Money value={a.amount} /></td>
              <td>{a.payment.status === "VOIDED" ? <Badge>ملغاة</Badge> : <Badge tone="green">مُرحّلة</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const allocationInclude = { payment: { include: { account: true } } } as const;
