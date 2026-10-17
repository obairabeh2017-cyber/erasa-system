import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isUniqueViolation, assert } from "../errors";
import { formatMoney, formatQty } from "../money";
import { addDays, dayOfPeriod, diffLocalDays, formatDate, formatPeriod, periodOf, previousPeriod, startOfLocalDay } from "../dates";
import { computeDebts } from "./debts";
import { saveMonthlyReport } from "./reports";

type ReminderInput = {
  type: string;
  title: string;
  message?: string | null;
  dueDate: Date;
  dedupeKey: string;
  link?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  recurrence?: string;
};

/** ينشئ التذكير مرة واحدة فقط لكل مفتاح (حدث + موعد). يعيد true إن أُنشئ. */
export async function createReminderOnce(db: PrismaClient, r: ReminderInput): Promise<boolean> {
  try {
    await db.reminder.create({ data: { ...r, recurrence: r.recurrence ?? "NONE" } });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

async function closeOpen(db: PrismaClient, where: { type: string; entityType?: string; entityId?: number }) {
  await db.reminder.updateMany({
    where: { ...where, status: { in: ["OPEN", "DISMISSED"] } },
    data: { status: "DONE", closedAt: new Date() },
  });
}

/**
 * يولّد التذكيرات التلقائية. آمن للتشغيل المتكرر: مفتاح dedupeKey الفريد يمنع التكرار
 * حتى لو شُغّل من عدة طلبات في نفس الوقت.
 */
export async function generateReminders(db: PrismaClient, now: Date = new Date()) {
  const settings = await db.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const today = startOfLocalDay(now);
  let created = 0;

  // ----- الديون: قريبة الاستحقاق والمتأخرة -----
  const debts = await computeDebts(db, addDays(now, 3650), now);
  const open = [...debts.customer, ...debts.supplier, ...debts.unpaidExpenses].filter((d) => d.remaining > 0);
  const openKeys = new Set(open.map((d) => `${d.docType}:${d.docId}`));
  for (const d of open) {
    if (!d.dueDate) continue;
    const daysLeft = diffLocalDays(now, d.dueDate);
    const who = d.kind === "CUSTOMER" ? `على ${d.partyName}` : d.kind === "SUPPLIER" ? `للمورّد ${d.partyName}` : `مصروف ${d.partyName}`;
    if (daysLeft < 0) {
      if (await createReminderOnce(db, {
        type: "DEBT_OVERDUE",
        title: `دين متأخر ${who} — ${d.docNumber}`,
        message: `المتبقي ${formatMoney(d.remaining)}، تاريخ الاستحقاق ${formatDate(d.dueDate)}`,
        dueDate: d.dueDate,
        dedupeKey: `OVERDUE:${d.docType}:${d.docId}:${d.dueDate.toISOString().slice(0, 10)}`,
        link: d.link, entityType: d.docType, entityId: d.docId,
      })) created++;
    } else if (daysLeft <= settings.debtReminderDaysAhead) {
      if (await createReminderOnce(db, {
        type: "DEBT_DUE_SOON",
        title: `يستحق قريباً ${who} — ${d.docNumber}`,
        message: `المتبقي ${formatMoney(d.remaining)}، يستحق في ${formatDate(d.dueDate)}`,
        dueDate: d.dueDate,
        dedupeKey: `DUESOON:${d.docType}:${d.docId}:${d.dueDate.toISOString().slice(0, 10)}`,
        link: d.link, entityType: d.docType, entityId: d.docId,
      })) created++;
    }
  }
  // إغلاق تذكيرات الديون التي سُددت
  const debtReminders = await db.reminder.findMany({
    where: { type: { in: ["DEBT_OVERDUE", "DEBT_DUE_SOON"] }, status: { in: ["OPEN", "DISMISSED"] } },
  });
  for (const r of debtReminders) {
    if (!openKeys.has(`${r.entityType}:${r.entityId}`)) {
      await db.reminder.update({ where: { id: r.id }, data: { status: "DONE", closedAt: now } });
    }
  }

  // ----- المخزون المنخفض: تذكير واحد لكل «نوبة» انخفاض -----
  const items = await db.item.findMany({ where: { active: true, minStock: { gt: 0 } }, include: { unit: true } });
  for (const it of items) {
    const latest = await db.reminder.findFirst({
      where: { type: "LOW_STOCK", entityType: "ITEM", entityId: it.id },
      orderBy: { id: "desc" },
    });
    const isLow = it.stockQty <= it.minStock;
    if (isLow) {
      if (latest && latest.status !== "DONE") continue; // نوبة قائمة (مفتوحة أو مُخفاة)
      const episode = (await db.reminder.count({ where: { type: "LOW_STOCK", entityType: "ITEM", entityId: it.id } })) + 1;
      if (await createReminderOnce(db, {
        type: "LOW_STOCK",
        title: `مخزون منخفض: ${it.name}`,
        message: `الرصيد ${formatQty(it.stockQty)} ${it.unit.name} — الحد الأدنى ${formatQty(it.minStock)}`,
        dueDate: today,
        dedupeKey: `LOW:${it.id}:${episode}`,
        link: `/items/${it.id}`, entityType: "ITEM", entityId: it.id,
      })) created++;
    } else if (latest && latest.status !== "DONE") {
      await closeOpen(db, { type: "LOW_STOCK", entityType: "ITEM", entityId: it.id });
    }
  }

  // ----- الرواتب -----
  const period = periodOf(now);
  const activeEmployees = await db.employee.count({ where: { active: true, baseSalary: { gt: 0 } } });
  if (activeEmployees > 0) {
    const due = dayOfPeriod(period, settings.salaryDayOfMonth);
    if (diffLocalDays(now, due) <= settings.salaryReminderDays) {
      if (await createReminderOnce(db, {
        type: "SALARY",
        title: `رواتب ${formatPeriod(period)}`,
        message: `موعد الرواتب ${formatDate(due)} لعدد ${activeEmployees} موظف`,
        dueDate: due,
        dedupeKey: `SALARY:${period}`,
        link: "/employees",
      })) created++;
    }
  }

  // ----- المصروفات الدورية -----
  const recurring = await db.recurringExpense.findMany({ where: { active: true } });
  for (const r of recurring) {
    const recorded = await db.expense.findFirst({ where: { recurringExpenseId: r.id, period } });
    if (recorded) {
      await closeOpen(db, { type: "RECURRING_EXPENSE", entityType: "RECURRING", entityId: r.id });
      continue;
    }
    const due = dayOfPeriod(period, r.dayOfMonth);
    if (diffLocalDays(now, due) <= 3) {
      if (await createReminderOnce(db, {
        type: "RECURRING_EXPENSE",
        title: `مصروف دوري: ${r.name}`,
        message: `${formatMoney(r.amount)} — موعده ${formatDate(due)}`,
        dueDate: due,
        dedupeKey: `RECUR:${r.id}:${period}`,
        link: "/expenses/recurring", entityType: "RECURRING", entityId: r.id,
      })) created++;
    }
  }

  // ----- التقرير الشهري للشهر المنتهي -----
  const prev = previousPeriod(period);
  const hasReport = await db.monthlyReport.findUnique({ where: { period: prev } });
  const anyActivity = (await db.stockMovement.count()) + (await db.payment.count()) > 0;
  if (!hasReport && anyActivity) {
    await saveMonthlyReport(db, prev, true, now);
  }
  if (anyActivity) {
    if (await createReminderOnce(db, {
      type: "MONTHLY_REPORT",
      title: `التقرير الشهري جاهز: ${formatPeriod(prev)}`,
      message: "راجع التقرير واطبعه أو احفظه PDF",
      dueDate: today,
      dedupeKey: `MONTHLY:${prev}`,
      link: `/reports/monthly/${prev}`,
    })) created++;
  }

  await db.appSettings.update({ where: { id: 1 }, data: { lastReminderRunAt: now } });
  return { created };
}

const RECURRENCES = ["NONE", "WEEKLY", "MONTHLY", "YEARLY"];

export async function createCustomReminder(
  db: PrismaClient,
  input: { title: string; message?: string | null; dueDate: Date; recurrence: string },
) {
  assert(input.title.trim(), "عنوان التذكير مطلوب");
  assert(RECURRENCES.includes(input.recurrence), "نوع التكرار غير صالح");
  const series = randomUUID();
  return db.reminder.create({
    data: {
      type: "CUSTOM",
      title: input.title.trim(),
      message: input.message ?? null,
      dueDate: input.dueDate,
      recurrence: input.recurrence,
      dedupeKey: `CUSTOM:${series}:${input.dueDate.toISOString()}`,
    },
  });
}

function nextOccurrence(date: Date, recurrence: string): Date | null {
  const d = new Date(date);
  if (recurrence === "WEEKLY") return addDays(d, 7);
  if (recurrence === "MONTHLY") { d.setUTCMonth(d.getUTCMonth() + 1); return d; }
  if (recurrence === "YEARLY") { d.setUTCFullYear(d.getUTCFullYear() + 1); return d; }
  return null;
}

/** إنهاء تذكير؛ المتكرر يُنشئ الموعد التالي مرة واحدة فقط. */
export async function completeReminder(db: PrismaClient, id: number, dismiss = false) {
  const r = await db.reminder.findUnique({ where: { id } });
  assert(r, "التذكير غير موجود");
  await db.reminder.update({ where: { id }, data: { status: dismiss ? "DISMISSED" : "DONE", closedAt: new Date() } });
  if (r.type === "CUSTOM" && r.recurrence !== "NONE") {
    const next = nextOccurrence(r.dueDate, r.recurrence);
    const series = r.dedupeKey.split(":")[1];
    if (next) {
      await createReminderOnce(db, {
        type: "CUSTOM", title: r.title, message: r.message, dueDate: next,
        recurrence: r.recurrence, dedupeKey: `CUSTOM:${series}:${next.toISOString()}`,
      });
    }
  }
}

export async function reopenReminder(db: PrismaClient, id: number) {
  await db.reminder.update({ where: { id }, data: { status: "OPEN", closedAt: null } });
}
