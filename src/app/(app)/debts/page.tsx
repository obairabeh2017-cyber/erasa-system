import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Stat, Badge } from "@/components/ui";
import { sp, type SearchParams } from "@/components/table";
import { computeDebts, type DebtRow } from "@/lib/services/debts";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "الديون" };

function DebtTable({ rows, partyLabel }: { rows: DebtRow[]; partyLabel: string }) {
  if (rows.length === 0) return <p className="text-sm text-stone-500">لا توجد ديون قائمة.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>المستند</th><th>{partyLabel}</th><th>التاريخ</th><th>الاستحقاق</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th><th>التأخير</th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={`${d.docType}-${d.docId}`} className={d.overdueDays > 0 ? "bg-red-50/60" : ""}>
              <td><Link href={d.link} className="font-mono text-brand-700 hover:underline" dir="ltr">{d.docNumber}</Link></td>
              <td>{d.partyId && d.kind !== "EXPENSE" ? <Link className="hover:underline" href={`${d.kind === "CUSTOMER" ? "/customers" : "/suppliers"}/${d.partyId}`}>{d.partyName}</Link> : d.partyName}</td>
              <td>{formatDate(d.date)}</td>
              <td>{formatDate(d.dueDate)}</td>
              <td><Money value={d.amount} /></td>
              <td><Money value={d.paid} /></td>
              <td><Money value={d.remaining} className={d.remaining < 0 ? "text-emerald-700" : "font-semibold"} />{d.remaining < 0 && <span className="ms-1 text-xs text-emerald-700">(دفع زائد)</span>}</td>
              <td>{d.overdueDays > 0 ? <Badge tone="red">{d.overdueDays} يوم</Badge> : d.dueDate ? <Badge tone="green">ضمن المهلة</Badge> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DebtsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const onlyOverdue = sp(params, "overdue") === "1";
  const debts = await computeDebts(prisma);
  const filter = (rows: DebtRow[]) => rows.filter((r) => (onlyOverdue ? r.overdueDays > 0 && r.remaining > 0 : true)).sort((a, b) => b.overdueDays - a.overdueDays);
  return (
    <div className="space-y-5">
      <PageHeader
        title="الديون"
        crumbs={[{ label: "الديون" }]}
        subtitle="محسوبة من الفواتير المُرحّلة والدفعات المُرحّلة فقط."
        actions={<><Link href={onlyOverdue ? "/debts" : "/debts?overdue=1"} className="btn btn-secondary">{onlyOverdue ? "عرض الكل" : "المتأخرة فقط"}</Link><a href={"/api/export/debts"} download className="btn btn-secondary">⬇ CSV</a></>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ديون الزبائن (لنا)" value={<Money value={debts.totals.customer} />} tone={debts.totals.customer > 0 ? "warn" : "default"} />
        <Stat label="ديون الموردين (علينا)" value={<Money value={debts.totals.supplier} />} tone={debts.totals.supplier > 0 ? "danger" : "default"} />
        <Stat label="مصروفات غير مسددة" value={<Money value={debts.totals.expenses} />} />
        <Stat label="سلف/أرصدة على الموظفين" value={<Money value={debts.totals.employeesOwingCompany} />} hint={`مستحق للموظفين: ${formatMoney(debts.totals.employeesOwedByCompany)}`} />
      </div>
      <Section title="ديون الزبائن"><DebtTable rows={filter(debts.customer)} partyLabel="الزبون" /></Section>
      <Section title="ديون الموردين"><DebtTable rows={filter(debts.supplier)} partyLabel="المورّد" /></Section>
      <Section title="مصروفات غير مسددة"><DebtTable rows={filter(debts.unpaidExpenses)} partyLabel="الفئة" /></Section>
      <Section title="أرصدة الموظفين (سلف ومستحقات)">
        {debts.employees.length === 0 ? <p className="text-sm text-stone-500">لا توجد أرصدة.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الموظف</th><th>سلف قائمة</th><th>الرصيد</th></tr></thead>
              <tbody>
                {debts.employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td><Link href={e.link} className="text-brand-700 hover:underline">{e.name}</Link></td>
                    <td><Money value={e.advances} /></td>
                    <td><Money value={Math.abs(e.balance)} className={e.balance < 0 ? "text-red-700" : ""} /> <span className="text-xs text-stone-500">{e.balance < 0 ? "على الموظف" : "مستحق للموظف"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
