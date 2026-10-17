import { requireOwner } from "@/lib/auth/owner";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shell";
import { generateReminders } from "@/lib/services/reminders";
import { ensureDefaults } from "@/lib/services/setup";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  // تهيئة القوائم الافتراضية عند أول تشغيل (آمنة للتكرار)
  if ((await prisma.unit.count()) === 0) await ensureDefaults(prisma);
  const settings = await prisma.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  // توليد التذكيرات عند فتح التطبيق إن مرّت ساعة على آخر تشغيل (آمن ضد التكرار)
  const stale = !settings.lastReminderRunAt || Date.now() - settings.lastReminderRunAt.getTime() > 3600_000;
  if (stale) {
    try {
      await generateReminders(prisma);
    } catch (e) {
      console.error("reminder generation failed", e);
    }
  }
  const open = await prisma.reminder.count({ where: { status: "OPEN", dueDate: { lte: new Date(Date.now() + 7 * 86400000) } } });
  return (
    <AppShell
      companyName={settings.companyName}
      reminders={open}
      logout={
        <form action={logoutAction}>
          <button type="submit" className="btn btn-ghost w-full justify-start text-brand-100 hover:bg-brand-700">↩ تسجيل الخروج</button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
