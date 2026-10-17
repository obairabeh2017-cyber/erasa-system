import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/auth/owner";
import { MIME_BY_EXT, resolveStored } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** يقدّم إيصال المصروف للمالك فقط (الملفات خارج public). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getOwner())) return Response.json({ error: "غير مصرح" }, { status: 401 });
  const { id } = await params;
  const e = await prisma.expense.findUnique({ where: { id: Number(id) } });
  if (!e?.receiptPath) return Response.json({ error: "لا يوجد إيصال" }, { status: 404 });
  const abs = resolveStored(e.receiptPath);
  if (!abs) return Response.json({ error: "مسار غير صالح" }, { status: 400 });
  try {
    const buf = await fs.readFile(abs);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME_BY_EXT[path.extname(abs)] ?? "application/octet-stream",
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "الملف غير موجود" }, { status: 404 });
  }
}
