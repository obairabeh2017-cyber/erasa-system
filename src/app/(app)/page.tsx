import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Stat, Money, Qty, Badge } from "@/components/ui";
import { MonthlyBarChart } from "@/components/bar-chart";
import { computeReport, monthlySeries } from "@/lib/services/reports";
import { addDays, formatDate, formatPeriod, monthRange, periodOf, shiftPeriod, startOfLocalDay } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { REMINDER_TYPE } from "@/lib/labels";

export const metadata = { title: "لوحة التحكم" };

const QUICK = [
  { href: "/sales/new", label: "فاتورة بيع", icon: "🧾" },
  { href: "/purchases/new", label: "فاتورة شراء", icon: "🚚" },
  { href: "/expenses/new", label: "مصروف", icon: "📉" },
  { href: "/production/new", label: "أمر إنتاج", icon: "🛠️" },
  { href: "/items/new", label: "مادة / منتج", icon: "📦" },
  { href: "/employees", label: "موظف", icon: "🧑‍🔧" },
];

export default async function Dashboard() {
  const now = new Date();
  const period = periodOf(now);
  const { start: monthStart, end: monthEnd } = monthRange(period);
  const todayStart = startOfLocalDay(now);
  const [month, todaySales, items, reminders, series] = await Promise.all([
    computeReport(prisma, monthStart, monthEnd, now),
    prisma.sale.aggregate({ where: { status: "POSTED", date: { gte: todayStart, lt: addDays(todayStart, 1) } }, _sum: { total: true }, _count: true }),
    prisma.item.findMany({ where: { active: true }, include: { unit: true }, orderBy: { name: "asc" } }),
    prisma.reminder.findMany({ where: { status: "OPEN" }, orderBy: { dueDate: "asc" }, take: 50 }),
    monthlySeries(prisma, Array.from({ length: 6 }, (_, i) => shiftPeriod(period, i - 5)).reverse()),
  ]);
  const raw = items.filter((i) => i.type === "RAW");
  const finished = items.filter((i) => i.type === "FINISHED");
  const low = items.filter((i) => i.minStock > 0 && i.stockQty <= i.minStock);
  const overdue = reminders.filter((r) => r.type === "DEBT_OVERDUE");
  const upcoming = reminders.filter((r) => ["SALARY", "RECURRING_EXPENSE", "DEBT_DUE_SOON", "CUSTOM"].includes(r.type));
  const totalExpenses = month.expenses.operating + month.expenses.salaries;
  const isEmpty = items.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="لوحة التحكم" subtitle={`${formatPeriod(period)} — كل الأرقام محسوبة من المستندات المُرحّلة في قاعدة البيانات`} />

      {isEmpty && (
        <div className="card border-s-4 border-s-brand-600 p-4 text-sm leading-7">
          <div className="mb-1 font-bold">ابدأ من هنا:</div>
          ١) أضف <Link href="/items/new" className="underline">المواد الخام</Link> بأرصدتها الافتتاحية ← ٢) أضف <Link href="/items/new?type=FINISHED" className="underline">المنتجات التامة</Link> ← ٣) عرّف <Link href="/recipes" className="underline">الوصفات</Link> ← ٤) سجّل <Link href="/cash" className="underline">رصيد الخزينة الافتتاحي</Link> ← ٥) ابدأ الإنتاج والبيع.
        </div>
      )}

      <nav aria-label="إجراءات سريعة" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {QUICK.map((q) => (
          <Link key={q.href} href={q.href} className="card flex flex-col items-center gap-1 p-3 text-center text-sm hover:bg-brand-50">
            <span aria-hidden className="text-xl">{q.icon}</span>+ {q.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="مبيعات اليوم" value={<Money value={todaySales._sum.total ?? 0} />} hint={`${todaySales._count} فاتورة`} href="/sales" />
        <Stat label="صافي مبيعات الشهر" value={<Money value={month.sales.net} />} hint={`${month.sales.count} فاتورة مُرحّلة`} href="/reports" />
        <Stat label="المقبوضات الفعلية هذا الشهر" value={<Money value={month.receipts.total} />} hint="نقد مستلم فعلاً (ليس المبيعات)" href="/payments?direction=IN" />
        <Stat label="مصروفات الشهر (تشغيلية + رواتب)" value={<Money value={totalExpenses} />} hint={`منها رواتب: ${formatMoney(month.expenses.salaries)}`} href="/expenses" />
        <Stat label="إجمالي الربح التقديري للشهر" value={<Money value={month.grossProfit} colored />} hint="المبيعات − تكلفة المواد الخام فقط" tone={month.grossProfit < 0 ? "danger" : "good"} href="/reports" />
        <Stat label="ديون الزبائن (لنا)" value={<Money value={month.debts.customer} />} tone={month.debts.customer > 0 ? "warn" : "default"} href="/debts" />
        <Stat label="ديون الموردين (علينا)" value={<Money value={month.debts.supplier} />} tone={month.debts.supplier > 0 ? "danger" : "default"} href="/debts" />
        <Stat label="النقدية في الحسابات" value={<Money value={month.cashTotal} />} hint="الرصيد النقدي ≠ الربح" href="/cash" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Section title="المبيعات والمصروفات (آخر 6 أشهر)" className="lg:col-span-2">
          <MonthlyBarChart data={series} />
        </Section>
        <Section title="تنبيهات" actions={<Link href="/reminders" className="btn btn-ghost btn-sm">الكل</Link>}>
          <ul className="space-y-2 text-sm">
            {low.length > 0 && (
              <li className="rounded-lg bg-amber-50 p-2">
                <div className="font-semibold text-amber-900">مخزون منخفض ({low.length})</div>
                <ul className="mt-1 space-y-0.5">
                  {low.slice(0, 6).map((i) => <li key={i.id}><Link href={`/items/${i.id}`} className="hover:underline">{i.name}</Link>: <Qty value={i.stockQty} unit={i.unit.name} /> / حد <Qty value={i.minStock} /></li>)}
                </ul>
              </li>
            )}
            {overdue.length > 0 && (
              <li className="rounded-lg bg-red-50 p-2">
                <div className="font-semibold text-red-900">ديون متأخرة ({overdue.length})</div>
                <ul className="mt-1 space-y-0.5">{overdue.slice(0, 6).map((r) => <li key={r.id}>{r.link ? <Link href={r.link} className="hover:underline">{r.title}</Link> : r.title}</li>)}</ul>
              </li>
            )}
            {upcoming.length > 0 && (
              <li className="rounded-lg bg-sky-50 p-2">
                <div className="font-semibold text-sky-900">قادم قريباً</div>
                <ul className="mt-1 space-y-0.5">{upcoming.slice(0, 8).map((r) => <li key={r.id}><Badge tone="blue">{REMINDER_TYPE[r.type]}</Badge> {r.title} — {formatDate(r.dueDate)}</li>)}</ul>
              </li>
            )}
            {low.length === 0 && overdue.length === 0 && upcoming.length === 0 && <li className="text-stone-500">لا توجد تنبيهات حالياً ✔</li>}
          </ul>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title={`مخزون المواد الخام — القيمة: ${formatMoney(sum(raw.map((i) => i.stockValue)))}`} actions={<Link href="/items?type=RAW" className="btn btn-ghost btn-sm">الكل</Link>}>
          <StockList items={raw} />
        </Section>
        <Section title={`مخزون المنتجات التامة — القيمة بالتكلفة: ${formatMoney(sum(finished.map((i) => i.stockValue)))}`} actions={<Link href="/items?type=FINISHED" className="btn btn-ghost btn-sm">الكل</Link>}>
          <StockList items={finished} />
        </Section>
      </div>
    </div>
  );
}

function StockList({ items }: { items: { id: number; name: string; stockQty: number; minStock: number; unit: { name: string } }[] }) {
  if (items.length === 0) return <p className="text-sm text-stone-500">لا توجد أصناف.</p>;
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {items.slice(0, 10).map((i) => {
        const isLow = i.minStock > 0 && i.stockQty <= i.minStock;
        return (
          <li key={i.id} className="flex items-center justify-between py-1.5">
            <Link href={`/items/${i.id}`} className="hover:underline">{i.name}</Link>
            <span className={isLow ? "font-bold text-red-700" : ""}><Qty value={i.stockQty} unit={i.unit.name} /></span>
          </li>
        );
      })}
    </ul>
  );
}
