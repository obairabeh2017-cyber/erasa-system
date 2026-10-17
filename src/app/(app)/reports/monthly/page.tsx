import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, EmptyState, Badge, Money } from "@/components/ui";
import { formatDateTime, formatPeriod } from "@/lib/dates";
import type { Report } from "@/lib/services/reports";

export const metadata = { title: "التقارير الشهرية" };

export default async function MonthlyReportsPage() {
  const rows = await prisma.monthlyReport.findMany({ orderBy: { period: "desc" } });
  return (
    <div>
      <PageHeader title="التقارير الشهرية المحفوظة" crumbs={[{ label: "التقارير", href: "/reports" }, { label: "الأرشيف الشهري" }]} subtitle="يُحفظ تقرير كل شهر منتهٍ تلقائياً عند تشغيل البرنامج. يمكن إعادة توليده من الحركات الأصلية في أي وقت." />
      {rows.length === 0 ? <EmptyState title="لا توجد تقارير محفوظة بعد" hint="سيُنشأ تقرير الشهر السابق تلقائياً، أو احفظه يدوياً من صفحة التقارير." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الشهر</th><th>صافي المبيعات</th><th>إجمالي الربح التقديري</th><th>المقبوضات</th><th>وقت التوليد</th><th>النوع</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = JSON.parse(r.data) as Report;
                return (
                  <tr key={r.id}>
                    <td><Link href={`/reports/monthly/${r.period}`} className="font-medium text-brand-700 hover:underline">{formatPeriod(r.period)}</Link></td>
                    <td><Money value={d.sales.net} /></td>
                    <td><Money value={d.grossProfit} colored /></td>
                    <td><Money value={d.receipts.total} /></td>
                    <td>{formatDateTime(r.generatedAt)}</td>
                    <td>{r.auto ? <Badge tone="blue">تلقائي</Badge> : <Badge>يدوي</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
