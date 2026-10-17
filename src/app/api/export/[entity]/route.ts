import { prisma } from "@/lib/db";
import { getOwner } from "@/lib/auth/owner";
import { buildDataset, exportFilename, toCsv } from "@/lib/services/exports";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  if (!(await getOwner())) return Response.json({ error: "غير مصرح" }, { status: 401 });
  const { entity } = await params;
  const d = await buildDataset(prisma, entity, new URL(req.url).searchParams);
  if (!d) return Response.json({ error: "نوع تصدير غير معروف أو معاملات غير صالحة" }, { status: 400 });
  return new Response(toCsv(d), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(d.filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}
