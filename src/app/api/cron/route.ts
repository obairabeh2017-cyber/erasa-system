import { prisma } from "@/lib/db";
import { generateReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * مسار يمكن أن تستدعيه خدمة جدولة خارجية (مثل cron-job.org): توليد التذكيرات وحفظ تقرير الشهر المنتهي (بدون تكرار).
 * محمي بالمتغير CRON_SECRET في ترويسة Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "غير مصرح" }, { status: 401 });
  }
  const r = await generateReminders(prisma);
  return Response.json({ ok: true, created: r.created });
}
