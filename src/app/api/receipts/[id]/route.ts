import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

/** يقدّم إيصال المصروف للمالك فقط (مخزّن داخل قاعدة البيانات). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getOwner())) return Response.json({ error: "غير مصرح" }, { status: 401 });
  const { id } = await params;
  const a = await prisma.attachment.findUnique({ where: { expenseId: Number(id) || 0 } });
  if (!a) return Response.json({ error: "لا يوجد إيصال" }, { status: 404 });
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
