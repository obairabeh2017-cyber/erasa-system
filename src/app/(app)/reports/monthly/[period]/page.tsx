import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Alert } from "@/components/ui";
import { ActionForm, PrintButton, SubmitButton } from "@/components/forms";
import { ReportView } from "@/components/report-view";
import { formatDateTime, formatPeriod, isPeriod } from "@/lib/dates";
import type { Report } from "@/lib/services/reports";
import { saveMonthlyReportAction } from "../../actions";

export default async function MonthlySnapshotPage({ params }: { params: Promise<{ period: string }> }) {
  const { period } = await params;
  if (!isPeriod(period)) notFound();
  const snap = await prisma.monthlyReport.findUnique({ where: { period } });
  if (!snap) notFound();
  const data = JSON.parse(snap.data) as Report;
  const title = `التقرير الشهري — ${formatPeriod(period)}`;
  return (
    <div>
      <PageHeader
        title={title}
        crumbs={[{ label: "التقارير", href: "/reports" }, { label: "الأرشيف", href: "/reports/monthly" }, { label: formatPeriod(period) }]}
        subtitle={`نسخة محفوظة بتاريخ ${formatDateTime(snap.generatedAt)}`}
        actions={<><Link href={`/reports?month=${period}`} className="btn btn-secondary">عرض محسوب الآن</Link><PrintButton /></>}
      />
      <div className="no-print mb-4 space-y-2">
        <Alert>هذه لقطة محفوظة. إن سُجّلت حركات متأخرة لهذا الشهر بعد الحفظ، أعد التوليد لتحديثها من الحركات الأصلية.</Alert>
        <ActionForm action={saveMonthlyReportAction}>
          <input type="hidden" name="period" value={period} />
          <SubmitButton className="btn btn-secondary btn-sm">إعادة توليد اللقطة</SubmitButton>
        </ActionForm>
      </div>
      <ReportView r={data} title={title} />
    </div>
  );
}
