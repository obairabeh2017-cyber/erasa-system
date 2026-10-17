import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ActionForm, PrintButton, SubmitButton } from "@/components/forms";
import { ReportView } from "@/components/report-view";
import { sp, type SearchParams } from "@/components/table";
import { computeReport } from "@/lib/services/reports";
import { dateRange, formatDate, formatPeriod, isDateInput, isPeriod, monthRange, periodOf, toDateInput } from "@/lib/dates";
import { saveMonthlyReportAction } from "./actions";

export const metadata = { title: "التقارير" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const from = sp(params, "from");
  const to = sp(params, "to");
  const month = sp(params, "month");
  let range: { start: Date; end: Date };
  let title: string;
  let period: string | null = null;
  if (isDateInput(from) && isDateInput(to) && from <= to) {
    range = dateRange(from, to);
    title = `تقرير الفترة من ${formatDate(range.start)} إلى ${formatDate(new Date(range.end.getTime() - 1))}`;
  } else {
    period = isPeriod(month) ? month : periodOf();
    range = monthRange(period);
    title = `التقرير الشهري — ${formatPeriod(period)}`;
  }
  const report = await computeReport(prisma, range.start, range.end);
  const csvFrom = toDateInput(range.start);
  const csvTo = toDateInput(new Date(range.end.getTime() - 1));

  return (
    <div>
      <PageHeader
        title="التقارير"
        crumbs={[{ label: "التقارير" }]}
        subtitle={title}
        actions={
          <>
            <Link href="/reports/monthly" className="btn btn-secondary">التقارير الشهرية المحفوظة</Link>
            <a href={`/api/export/report?from=${csvFrom}&to=${csvTo}`} className="btn btn-secondary">⬇ CSV</a>
            <PrintButton />
          </>
        }
      />
      <div className="no-print mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <form method="get" className="card flex flex-wrap items-end gap-2 p-3">
          <div><label className="label" htmlFor="month">شهر</label><input id="month" name="month" type="month" className="input" defaultValue={period ?? periodOf()} /></div>
          <button className="btn btn-primary" type="submit">عرض الشهر</button>
        </form>
        <form method="get" className="card flex flex-wrap items-end gap-2 p-3">
          <div><label className="label" htmlFor="from">من</label><input id="from" name="from" type="date" className="input" defaultValue={csvFrom} /></div>
          <div><label className="label" htmlFor="to">إلى</label><input id="to" name="to" type="date" className="input" defaultValue={csvTo} /></div>
          <button className="btn btn-primary" type="submit">عرض الفترة</button>
        </form>
      </div>
      {period && (
        <ActionForm action={saveMonthlyReportAction} className="no-print mb-4">
          <input type="hidden" name="period" value={period} />
          <SubmitButton className="btn btn-secondary btn-sm">حفظ نسخة من تقرير {formatPeriod(period)} في الأرشيف</SubmitButton>
        </ActionForm>
      )}
      <ReportView r={report} title={title} />
    </div>
  );
}
