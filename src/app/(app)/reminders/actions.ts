"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { completeReminder, createCustomReminder, generateReminders, reopenReminder } from "@/lib/services/reminders";

export const createReminderAction = ownerAction(async (fd) => {
  await createCustomReminder(prisma, {
    title: f.text(fd, "title", "العنوان"),
    message: f.optText(fd, "message"),
    dueDate: f.date(fd, "dueDate", "الموعد"),
    recurrence: f.oneOf(fd, "recurrence", ["NONE", "WEEKLY", "MONTHLY", "YEARLY"] as const, "التكرار"),
  });
  return { message: "تمت إضافة التذكير" };
});

export const reminderStatusAction = ownerAction(async (fd) => {
  const id = f.id(fd, "id", "التذكير");
  const op = f.oneOf(fd, "op", ["done", "dismiss", "reopen"] as const, "الإجراء");
  if (op === "reopen") await reopenReminder(prisma, id);
  else await completeReminder(prisma, id, op === "dismiss");
  return { message: "تم التحديث" };
});

export const runRemindersAction = ownerAction(async () => {
  const r = await generateReminders(prisma);
  return { message: r.created > 0 ? `أُنشئ ${r.created} تذكير جديد` : "لا توجد تذكيرات جديدة (لا تكرار)" };
});
