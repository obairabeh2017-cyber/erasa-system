import Link from "next/link";

export type SearchParams = Record<string, string | string[] | undefined>;

export function sp(params: SearchParams, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export const PAGE_SIZE = 25;

/** يقرأ معاملات البحث والترتيب والصفحة من الرابط مع قائمة ترتيب مسموحة. */
export function listParams<T extends string>(params: SearchParams, sorts: readonly T[], defaultSort: T, defaultDir: "asc" | "desc" = "desc") {
  const q = sp(params, "q");
  const page = Math.max(1, Number(sp(params, "page")) || 1);
  const sortRaw = sp(params, "sort") as T;
  const sort = sorts.includes(sortRaw) ? sortRaw : defaultSort;
  const dir: "asc" | "desc" = sp(params, "dir") === "asc" ? "asc" : sp(params, "dir") === "desc" ? "desc" : defaultDir;
  return { q, page, sort, dir, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
}

function hrefWith(base: string, params: SearchParams, patch: Record<string, string | number | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) u.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") u.delete(k);
    else u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

export function SortTh({ base, params, field, label, current, dir }: { base: string; params: SearchParams; field: string; label: string; current: string; dir: string }) {
  const active = current === field;
  const nextDir = active && dir === "asc" ? "desc" : "asc";
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={hrefWith(base, params, { sort: field, dir: nextDir, page: null })} className="inline-flex items-center gap-1 hover:text-brand-700">
        {label}
        <span aria-hidden className="text-[10px]">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </Link>
    </th>
  );
}

export function Pagination({ base, params, page, total }: { base: string; params: SearchParams; page: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return <div className="mt-3 text-xs text-stone-500">العدد: {total}</div>;
  return (
    <nav aria-label="الصفحات" className="no-print mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-stone-500">صفحة {page} من {pages} — العدد: {total}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="btn btn-secondary btn-sm" href={hrefWith(base, params, { page: page - 1 })}>السابق</Link> : <span className="btn btn-secondary btn-sm opacity-50">السابق</span>}
        {page < pages ? <Link className="btn btn-secondary btn-sm" href={hrefWith(base, params, { page: page + 1 })}>التالي</Link> : <span className="btn btn-secondary btn-sm opacity-50">التالي</span>}
      </div>
    </nav>
  );
}

/** شريط بحث وتصفية (نموذج GET — يعمل بدون JavaScript). */
export function FilterBar({
  base,
  q,
  placeholder = "بحث…",
  children,
  exportHref,
}: {
  base: string;
  q?: string;
  placeholder?: string;
  children?: React.ReactNode;
  exportHref?: string;
}) {
  return (
    <form action={base} method="get" role="search" className="no-print mb-3 flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <label htmlFor="q" className="sr-only">بحث</label>
        <input id="q" name="q" defaultValue={q} placeholder={placeholder} className="input" />
      </div>
      {children}
      <button className="btn btn-secondary" type="submit">بحث</button>
      <Link href={base} className="btn btn-ghost">مسح</Link>
      {exportHref && <a href={exportHref} className="btn btn-secondary">⬇ تصدير CSV</a>}
    </form>
  );
}
