import Link from "next/link";
import { formatMoney, formatQty } from "@/lib/money";
import { DOC_STATUS } from "@/lib/labels";

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  crumbs = [],
  actions,
  subtitle,
}: {
  title: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <nav aria-label="مسار التنقل" className="no-print mb-1 text-xs text-stone-500">
        <ol className="flex flex-wrap items-center gap-1">
          <li><Link href="/" className="hover:text-brand-700">الرئيسية</Link></li>
          {crumbs.map((c, i) => (
            <li key={i} className="flex items-center gap-1">
              <span aria-hidden>‹</span>
              {c.href ? <Link href={c.href} className="hover:text-brand-700">{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-stone-900 sm:text-2xl">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-stone-500">{subtitle}</div>}
        </div>
        {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Money({ value, className = "", colored = false }: { value: number | null | undefined; className?: string; colored?: boolean }) {
  const v = value ?? 0;
  const color = colored ? (v < 0 ? "text-red-700" : v > 0 ? "text-emerald-700" : "") : "";
  return <span className={`num ${color} ${className}`}>{formatMoney(v)}</span>;
}

export function Qty({ value, unit, className = "" }: { value: number | null | undefined; unit?: string; className?: string }) {
  return (
    <span className={className}>
      <span className="num">{formatQty(value ?? 0)}</span>
      {unit ? <span className="text-stone-500"> {unit}</span> : null}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-800",
  POSTED: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  VOIDED: "bg-stone-200 text-stone-600 line-through",
  CANCELLED: "bg-stone-200 text-stone-600",
  REVERSED: "bg-stone-200 text-stone-600",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_COLORS[status] ?? "bg-stone-100 text-stone-700"}`}>{DOC_STATUS[status] ?? status}</span>;
}

export function Badge({ children, tone = "stone" }: { children: React.ReactNode; tone?: "stone" | "red" | "amber" | "green" | "blue" }) {
  const tones = {
    stone: "bg-stone-100 text-stone-700",
    red: "bg-red-100 text-red-800",
    amber: "bg-amber-100 text-amber-800",
    green: "bg-emerald-100 text-emerald-800",
    blue: "bg-sky-100 text-sky-800",
  };
  return <span className={`badge ${tones[tone]}`}>{children}</span>;
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "warn" | "danger" | "good";
  href?: string;
}) {
  const border = { default: "", warn: "border-s-4 border-s-amber-500", danger: "border-s-4 border-s-red-600", good: "border-s-4 border-s-emerald-600" }[tone];
  const body = (
    <div className={`card h-full p-4 ${border}`}>
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-stone-900 sm:text-xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-3xl" aria-hidden>🪑</div>
      <div className="font-semibold text-stone-800">{title}</div>
      {hint && <p className="max-w-md text-sm text-stone-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Section({ title, children, actions, className = "" }: { title: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-stone-900">{title}</h2>
        {actions && <div className="no-print flex gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
  className = "",
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: React.ReactNode }) {
  const c = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
  }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-sm leading-6 ${c}`}>{children}</div>;
}

export function DL({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-stone-100 py-1.5">
          <dt className="text-stone-500">{k}</dt>
          <dd className="text-end font-medium text-stone-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
