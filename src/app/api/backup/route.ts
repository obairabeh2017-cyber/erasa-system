import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/auth/owner";
import { audit } from "@/lib/audit";
import { backupFilename, exportAll } from "@/lib/services/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** تنزيل نسخة احتياطية كاملة (JSON) — للمالك فقط. */
export async function GET() {
  if (!(await getOwner())) return Response.json({ error: "غير مصرح" }, { status: 401 });
  const dump = await exportAll(prisma);
  await audit(prisma, "BACKUP_DOWNLOADED", "Backup", null, { counts: dump.counts });
  return new Response(JSON.stringify(dump), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}
