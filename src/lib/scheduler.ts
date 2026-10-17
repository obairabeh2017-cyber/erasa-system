import { prisma } from "./db";
import { autoBackupIfDue } from "./services/backup";
import { generateReminders } from "./services/reminders";

const g = globalThis as unknown as { __schedulerStarted?: boolean };
const EVERY_MS = 30 * 60 * 1000;

async function tick() {
  try {
    const b = await autoBackupIfDue(prisma);
    if (b) console.log(`[scheduler] auto backup: ${b.file}`);
  } catch (e) {
    console.error("[scheduler] backup failed", e);
  }
  try {
    // يولّد التذكيرات ويحفظ تقرير الشهر المنتهي تلقائياً (بدون تكرار)
    await generateReminders(prisma);
  } catch (e) {
    console.error("[scheduler] reminders failed", e);
  }
}

/** مهام دورية تعمل ما دام البرنامج مفتوحاً على جهاز المالك. */
export function startScheduler() {
  if (g.__schedulerStarted) return;
  g.__schedulerStarted = true;
  setTimeout(tick, 20_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
  console.log("[scheduler] started (every 30 min)");
}
