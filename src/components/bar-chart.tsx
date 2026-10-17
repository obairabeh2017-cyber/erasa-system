import { formatMoney } from "@/lib/money";
import { formatPeriod } from "@/lib/dates";

/** رسم أعمدة بسيط (SVG من الخادم، بدون مكتبات) للمبيعات مقابل المصروفات شهرياً. */
export function MonthlyBarChart({ data }: { data: { period: string; sales: number; expenses: number }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.sales, d.expenses]));
  const W = 640;
  const H = 220;
  const pad = { top: 16, bottom: 36, side: 8 };
  const groupW = (W - pad.side * 2) / data.length;
  const barW = Math.min(28, groupW / 3);
  const h = (v: number) => Math.round(((H - pad.top - pad.bottom) * Math.max(0, v)) / max);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="المبيعات والمصروفات الشهرية">
        <line x1={pad.side} x2={W - pad.side} y1={H - pad.bottom} y2={H - pad.bottom} stroke="#d6d3d1" />
        {data.map((d, i) => {
          // ترتيب من اليمين إلى اليسار ليتوافق مع اتجاه القراءة العربية
          const gx = W - pad.side - (i + 1) * groupW + groupW / 2;
          const sh = h(d.sales);
          const eh = h(d.expenses);
          const [y, m] = d.period.split("-");
          return (
            <g key={d.period}>
              <rect x={gx + 2} y={H - pad.bottom - sh} width={barW} height={sh} rx={3} fill="#2563c4">
                <title>{`${formatPeriod(d.period)} — المبيعات: ${formatMoney(d.sales)}`}</title>
              </rect>
              <rect x={gx - barW - 2} y={H - pad.bottom - eh} width={barW} height={eh} rx={3} fill="#94a3b8">
                <title>{`${formatPeriod(d.period)} — المصروفات: ${formatMoney(d.expenses)}`}</title>
              </rect>
              <text x={gx} y={H - pad.bottom + 16} textAnchor="middle" fontSize="11" fill="#57534e">{`${m}/${y.slice(2)}`}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-center gap-4 text-xs text-stone-600">
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-brand-600" /> صافي المبيعات</span>
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-slate-400" /> المصروفات والرواتب</span>
      </figcaption>
      <table className="sr-only">
        <caption>المبيعات والمصروفات الشهرية</caption>
        <thead><tr><th>الشهر</th><th>المبيعات</th><th>المصروفات</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.period}><td>{formatPeriod(d.period)}</td><td>{formatMoney(d.sales)}</td><td>{formatMoney(d.expenses)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
