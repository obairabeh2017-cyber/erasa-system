import type { Employee } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { toDateInput, todayInput } from "@/lib/dates";
import { toInputDecimal } from "@/lib/money";
import type { ActionState } from "@/lib/actions";

export function EmployeeForm({ action, employee }: { action: (p: ActionState | undefined, fd: FormData) => Promise<ActionState>; employee?: Employee }) {
  return (
    <ActionForm action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {employee && <input type="hidden" name="id" value={employee.id} />}
      <div><label className="label" htmlFor="code">رمز الموظف *</label><input id="code" name="code" className="input" dir="ltr" required defaultValue={employee?.code} /></div>
      <div className="lg:col-span-2"><label className="label" htmlFor="name">الاسم الكامل *</label><input id="name" name="name" className="input" required defaultValue={employee?.name} /></div>
      <div><label className="label" htmlFor="phone">الهاتف</label><input id="phone" name="phone" className="input" dir="ltr" defaultValue={employee?.phone ?? ""} /></div>
      <div><label className="label" htmlFor="jobTitle">الوظيفة</label><input id="jobTitle" name="jobTitle" className="input" defaultValue={employee?.jobTitle ?? ""} placeholder="نجار، منجد، دهان…" /></div>
      <div><label className="label" htmlFor="baseSalary">الراتب الأساسي الشهري (د.ل)</label><input id="baseSalary" name="baseSalary" className="input" inputMode="decimal" dir="ltr" defaultValue={employee ? toInputDecimal(employee.baseSalary) : ""} /></div>
      <div><label className="label" htmlFor="startDate">تاريخ البدء</label><input id="startDate" name="startDate" type="date" className="input" defaultValue={employee ? toDateInput(employee.startDate) : todayInput()} /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="notes">ملاحظات</label><input id="notes" name="notes" className="input" defaultValue={employee?.notes ?? ""} /></div>
      {employee && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={employee.active} className="size-4" /> على رأس العمل (نشط)</label>}
      <div className="sm:col-span-2 lg:col-span-3"><SubmitButton>{employee ? "حفظ" : "إضافة الموظف"}</SubmitButton></div>
    </ActionForm>
  );
}
