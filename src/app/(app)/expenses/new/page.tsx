import { PageHeader, Section } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PaymentFields } from "@/components/payment-fields";
import { accountOptions, categoryOptions, employeeOptions } from "@/lib/options";
import { todayInput } from "@/lib/dates";
import { createExpenseAction } from "../actions";

export const metadata = { title: "مصروف جديد" };

export default async function NewExpensePage() {
  const [categories, accounts, employees] = await Promise.all([categoryOptions("EXPENSE"), accountOptions(), employeeOptions()]);
  return (
    <div>
      <PageHeader title="مصروف جديد" crumbs={[{ label: "المصروفات", href: "/expenses" }, { label: "جديد" }]} />
      <Section title="بيانات المصروف">
        <ActionForm action={createExpenseAction} className="space-y-4" encType="multipart/form-data">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className="label" htmlFor="date">التاريخ *</label><input id="date" name="date" type="date" className="input" defaultValue={todayInput()} required /></div>
            <div>
              <label className="label" htmlFor="categoryId">الفئة *</label>
              <select id="categoryId" name="categoryId" className="input" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </div>
            <div><label className="label" htmlFor="amount">المبلغ (د.ل) *</label><input id="amount" name="amount" className="input" inputMode="decimal" dir="ltr" required /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="description">الوصف *</label><input id="description" name="description" className="input" required /></div>
            <div>
              <label className="label" htmlFor="employeeId">موظف مرتبط (اختياري)</label>
              <select id="employeeId" name="employeeId" className="input"><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            </div>
            <div><label className="label" htmlFor="receipt">صورة الإيصال (اختياري)</label><input id="receipt" name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="notes">ملاحظات</label><input id="notes" name="notes" className="input" /></div>
          </div>
          <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3">
            <legend className="px-1 text-sm font-semibold text-stone-700">السداد</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="payment" value="now" defaultChecked /> مدفوع الآن من حساب الشركة</label>
              <label className="flex items-center gap-2"><input type="radio" name="payment" value="later" /> غير مدفوع (يُسدد لاحقاً)</label>
              <label className="flex items-center gap-2"><input type="radio" name="payment" value="employee" /> دفعه موظف من ماله الخاص</label>
            </div>
            <PaymentFields accounts={accounts} showAmount={false} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="dueDate">تاريخ الاستحقاق (لغير المدفوع)</label><input id="dueDate" name="dueDate" type="date" className="input" /></div>
              <div>
                <label className="label" htmlFor="paidByEmployeeId">الموظف الذي دفع (يصبح مستحقاً له)</label>
                <select id="paidByEmployeeId" name="paidByEmployeeId" className="input"><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              </div>
            </div>
          </fieldset>
          <SubmitButton>حفظ المصروف</SubmitButton>
        </ActionForm>
      </Section>
    </div>
  );
}
