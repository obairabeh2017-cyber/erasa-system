import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Badge, EmptyState } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { sp, type SearchParams } from "@/components/table";
import { REMINDER_TYPE, RECURRENCE } from "@/lib/labels";
import { formatDate, todayInput, diffLocalDays } from "@/lib/dates";
import { createReminderAction, reminderStatusAction, runRemindersAction } from "./actions";

export const metadata = { title: "التذكيرات" };

const TONE: Record<string, "red" | "amber" | "blue" | "green" | "stone"> = {
  DEBT_OVERDUE: "red", DEBT_DUE_SOON: "amber", LOW_STOCK: "amber", SALARY: "blue", RECURRING_EXPENSE: "blue", MONTHLY_REPORT: "green", CUSTOM: "stone",
};

export default async function RemindersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const status = sp(params, "status") || "OPEN";
  const rows = await prisma.reminder.findMany({
    where: status === "ALL" ? {} : { status },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: 300,
  });
  const now = new Date();
  return (
    <div className="space-y-5">
      <PageHeader
        title="التذكيرات"
        crumbs={[{ label: "التذكيرات" }]}
        subtitle="تُولَّد تلقائياً عند تشغيل البرنامج (الديون، الرواتب، المصروفات الدورية، المخزون المنخفض، التقرير الشهري) دون تكرار، وتبقى ظاهرة هنا حتى تُنهيها."
        actions={<ActionForm action={runRemindersAction}><SubmitButton className="btn btn-secondary">تحديث التذكيرات الآن</SubmitButton></ActionForm>}
      />
      <nav className="flex gap-2 text-sm" aria-label="تصفية الحالة">
        {[["OPEN", "المفتوحة"], ["DONE", "المنتهية"], ["DISMISSED", "المُخفاة"], ["ALL", "الكل"]].map(([k, v]) => (
          <Link key={k} href={`/reminders?status=${k}`} className={`btn btn-sm ${status === k ? "btn-primary" : "btn-secondary"}`}>{v}</Link>
        ))}
      </nav>
      {rows.length === 0 ? <EmptyState title="لا توجد تذكيرات" /> : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const days = diffLocalDays(now, r.dueDate);
            return (
              <li key={r.id} className="card flex flex-wrap items-center gap-3 p-3">
                <Badge tone={TONE[r.type] ?? "stone"}>{REMINDER_TYPE[r.type] ?? r.type}</Badge>
                <div className="min-w-48 flex-1">
                  <div className="font-medium">{r.link ? <Link href={r.link} className="hover:underline">{r.title}</Link> : r.title}</div>
                  {r.message && <div className="text-sm text-stone-600">{r.message}</div>}
                  <div className="text-xs text-stone-500">
                    الموعد: {formatDate(r.dueDate)} {r.status === "OPEN" && (days < 0 ? `(منذ ${-days} يوم)` : days === 0 ? "(اليوم)" : `(بعد ${days} يوم)`)}
                    {r.recurrence !== "NONE" && ` — ${RECURRENCE[r.recurrence]}`}
                  </div>
                </div>
                <div className="flex gap-1">
                  {r.status === "OPEN" ? (
                    <>
                      <ActionForm action={reminderStatusAction} showSuccess={false}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="done" /><SubmitButton className="btn btn-primary btn-sm">تم</SubmitButton></ActionForm>
                      <ActionForm action={reminderStatusAction} showSuccess={false}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="dismiss" /><SubmitButton className="btn btn-secondary btn-sm">إخفاء</SubmitButton></ActionForm>
                    </>
                  ) : (
                    <ActionForm action={reminderStatusAction} showSuccess={false}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="reopen" /><SubmitButton className="btn btn-secondary btn-sm">إعادة فتح</SubmitButton></ActionForm>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Section title="تذكير مخصص">
        <ActionForm action={createReminderAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" resetOnSuccess>
          <div className="lg:col-span-2"><label className="label" htmlFor="r-title">العنوان *</label><input id="r-title" name="title" className="input" required /></div>
          <div><label className="label" htmlFor="r-due">الموعد</label><input id="r-due" name="dueDate" type="date" className="input" defaultValue={todayInput()} /></div>
          <div><label className="label" htmlFor="r-rec">التكرار</label><select id="r-rec" name="recurrence" className="input">{Object.entries(RECURRENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="label" htmlFor="r-msg">التفاصيل</label><input id="r-msg" name="message" className="input" /></div>
          <div className="flex items-end"><SubmitButton>إضافة</SubmitButton></div>
        </ActionForm>
      </Section>
    </div>
  );
}
