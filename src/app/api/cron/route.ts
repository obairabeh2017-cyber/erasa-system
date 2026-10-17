import { prisma } from "@/lib/db";
import { generateReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * مهمة يومية تستدعيها Vercel Cron: توليد التذكيرات وحفظ تقرير الشهر المنتهي (بدون تكرار).
 * محمية بالمتغير CRON_SECRET (ترسله Vercel في ترويسة Authorization).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "غير مصرح" }, { status: 401 });
  }
  const r = await generateReminders(prisma);
  return Response.json({ ok: true, created: r.created });
}
