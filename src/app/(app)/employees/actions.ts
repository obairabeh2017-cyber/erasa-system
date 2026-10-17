"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { audit } from "@/lib/audit";
import { addEmployeeTransaction, generateSalaries, voidEmployeeTransaction, MANUAL_TYPES, CASH_IN_TYPES, CASH_OUT_TYPES } from "@/lib/services/employees";
import { isPeriod } from "@/lib/dates";
import { BusinessError } from "@/lib/errors";

function employeeData(fd: FormData) {
  return {
    code: f.text(fd, "code", "رمز الموظف", 30),
    name: f.text(fd, "name", "الاسم الكامل"),
    phone: f.optText(fd, "phone", 40),
    jobTitle: f.optText(fd, "jobTitle", 80),
    baseSalary: f.money(fd, "baseSalary", "الراتب الأساسي"),
    startDate: f.date(fd, "startDate", "تاريخ البدء"),
    notes: f.optText(fd, "notes"),
  };
}

export const createEmployeeAction = ownerAction(async (fd) => {
  const e = await prisma.employee.create({ data: employeeData(fd) });
  await audit(prisma, "EMPLOYEE_CREATED", "Employee", e.id, { code: e.code });
  return `/employees/${e.id}`;
});

export const updateEmployeeAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "الموظف");
  const data = { ...employeeData(fd), active: f.bool(fd, "active") };
  await prisma.employee.update({ where: { id }, data });
  await audit(prisma, "EMPLOYEE_UPDATED", "Employee", id, data);
  return { message: "تم الحفظ" };
});

export const employeeTxnAction = ownerAction(async (fd) => {
  const type = f.oneOf(fd, "type", MANUAL_TYPES, "نوع الحركة");
  const isCash = CASH_OUT_TYPES.includes(type) || CASH_IN_TYPES.includes(type);
  const period = f.optText(fd, "period", 7);
  if (type === "SALARY_DUE" && (!period || !isPeriod(period))) throw new BusinessError("حدد شهر الراتب (YYYY-MM)");
  await addEmployeeTransaction(prisma, {
    employeeId: f.id(fd, "id", "الموظف"),
    type,
    amount: f.money(fd, "amount", "المبلغ", { required: true }),
    date: f.date(fd, "date", "التاريخ"),
    period: type === "SALARY_DUE" ? period : null,
    description: f.optText(fd, "description"),
    payment: isCash ? { accountId: f.id(fd, "accountId", "الحساب"), method: f.optText(fd, "method") ?? "CASH", reference: f.optText(fd, "reference") } : null,
  });
  return { message: "تم تسجيل الحركة" };
});

export const voidEmployeeTxnAction = ownerAction(async (fd) => {
  await voidEmployeeTransaction(prisma, f.id(fd, "txnId", "الحركة"), f.text(fd, "reason", "السبب"));
  return { message: "تم إلغاء الحركة" };
});

export const generateSalariesAction = ownerAction(async (fd) => {
  const period = f.text(fd, "period", "الشهر", 7);
  if (!isPeriod(period)) throw new BusinessError("صيغة الشهر غير صحيحة");
  const s = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  const n = await generateSalaries(prisma, period, s.salaryDayOfMonth);
  return { message: n > 0 ? `تم تسجيل ${n} راتب مستحق لشهر ${period}` : "رواتب هذا الشهر مسجلة مسبقاً لكل الموظفين النشطين" };
});
