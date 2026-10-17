import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, Badge, EmptyState } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { FilterBar, sp, type SearchParams } from "@/components/table";
import { EMP_SIGN } from "@/lib/services/employees";
import { periodOf } from "@/lib/dates";
import { EmployeeForm } from "./employee-form";
import { createEmployeeAction, generateSalariesAction } from "./actions";

export const metadata = { title: "الموظفون" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const q = sp(params, "q");
  const status = sp(params, "status") || "active";
  const employees = await prisma.employee.findMany({
    where: {
      ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { jobTitle: { contains: q } }] } : {}),
      ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
    },
    include: { transactions: { where: { status: "POSTED" } } },
    orderBy: { name: "asc" },
  });
  return (
    <div className="space-y-5">
      <PageHeader title="الموظفون" crumbs={[{ label: "الموظفون" }]} subtitle="سجلات الموظفين فقط — لا يملك الموظفون حسابات دخول." />
      <Section title="توليد الرواتب المستحقة لشهر">
        <ActionForm action={generateSalariesAction} className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="period">الشهر</label><input id="period" name="period" type="month" className="input" defaultValue={periodOf()} required /></div>
          <SubmitButton>تسجيل رواتب الموظفين النشطين</SubmitButton>
          <p className="w-full text-xs text-stone-500">يُسجّل الراتب الأساسي كمستحق (مصروف رواتب) مرة واحدة لكل موظف في الشهر. صرف الراتب أو السلفة حركة نقدية منفصلة لا تُحتسب مصروفاً مرة ثانية.</p>
        </ActionForm>
      </Section>
      <FilterBar base="/employees" q={q} placeholder="بحث بالاسم أو الرمز أو الوظيفة" exportHref="/api/export/employees">
        <select name="status" defaultValue={status} className="input w-auto" aria-label="الحالة"><option value="active">النشطون</option><option value="inactive">غير النشطين</option><option value="all">الكل</option></select>
      </FilterBar>
      {employees.length === 0 ? <EmptyState title="لا يوجد موظفون" hint="أضف الموظفين لتتبع الرواتب والسلف والمكافآت." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الرمز</th><th>الاسم</th><th>الوظيفة</th><th>الهاتف</th><th>الراتب الأساسي</th><th>الرصيد</th><th>الحالة</th></tr></thead>
            <tbody>
              {employees.map((e) => {
                const bal = e.transactions.reduce((a, t) => a + EMP_SIGN[t.type] * t.amount, 0);
                return (
                  <tr key={e.id}>
                    <td className="font-mono" dir="ltr">{e.code}</td>
                    <td><Link href={`/employees/${e.id}`} className="font-medium text-brand-700 hover:underline">{e.name}</Link></td>
                    <td>{e.jobTitle ?? "—"}</td>
                    <td dir="ltr" className="text-end">{e.phone ?? "—"}</td>
                    <td><Money value={e.baseSalary} /></td>
                    <td>
                      <Money value={Math.abs(bal)} className={bal < 0 ? "text-red-700" : ""} />
                      <span className="ms-1 text-xs text-stone-500">{bal > 0 ? "مستحق له" : bal < 0 ? "عليه للشركة" : ""}</span>
                    </td>
                    <td>{e.active ? <Badge tone="green">نشط</Badge> : <Badge>غير نشط</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Section title="إضافة موظف">
        <EmployeeForm action={createEmployeeAction} />
      </Section>
    </div>
  );
}
