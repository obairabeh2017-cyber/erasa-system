"use server";

import { prisma } from "@/lib/db";
import { ownerAction } from "@/lib/actions";
import * as f from "@/lib/form";
import { saveMonthlyReport } from "@/lib/services/reports";
import { isPeriod } from "@/lib/dates";
import { BusinessError } from "@/lib/errors";

export const saveMonthlyReportAction = ownerAction(async (fd) => {
  const period = f.text(fd, "period", "الشهر", 7);
  if (!isPeriod(period)) throw new BusinessError("صيغة الشهر غير صحيحة");
  await saveMonthlyReport(prisma, period, false);
  return `/reports/monthly/${period}`;
});
