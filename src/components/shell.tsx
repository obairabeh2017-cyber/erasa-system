"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV: { group: string; items: { href: string; label: string; icon: string }[] }[] = [
  { group: "", items: [{ href: "/", label: "لوحة التحكم", icon: "🏠" }] },
  {
    group: "المخزون والإنتاج",
    items: [
      { href: "/items", label: "الأصناف والمخزون", icon: "📦" },
      { href: "/recipes", label: "وصفات المنتجات", icon: "📋" },
      { href: "/production", label: "أوامر الإنتاج", icon: "🛠️" },
    ],
  },
  {
    group: "المبيعات والمشتريات",
    items: [
      { href: "/sales", label: "فواتير البيع", icon: "🧾" },
      { href: "/customers", label: "الزبائن", icon: "👥" },
      { href: "/purchases", label: "فواتير الشراء", icon: "🚚" },
      { href: "/suppliers", label: "الموردون", icon: "🏭" },
    ],
  },
  {
    group: "المالية",
    items: [
      { href: "/payments", label: "المقبوضات والمدفوعات", icon: "💵" },
      { href: "/cash", label: "الخزينة والحسابات", icon: "🏦" },
      { href: "/expenses", label: "المصروفات", icon: "📉" },
      { href: "/income", label: "إيرادات أخرى", icon: "📈" },
      { href: "/debts", label: "الديون", icon: "⚖️" },
    ],
  },
  {
    group: "الإدارة",
    items: [
      { href: "/employees", label: "الموظفون", icon: "🧑‍🔧" },
      { href: "/reminders", label: "التذكيرات", icon: "🔔" },
      { href: "/reports", label: "التقارير", icon: "📊" },
      { href: "/phone", label: "الوصول من الهاتف", icon: "📱" },
      { href: "/settings", label: "الإعدادات والنسخ", icon: "⚙️" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function NavList({ pathname, reminders, onNavigate }: { pathname: string; reminders: number; onNavigate?: () => void }) {
  return (
    <nav aria-label="القائمة الرئيسية" className="flex flex-col gap-4 p-3">
      {NAV.map((g, gi) => (
        <div key={gi}>
          {g.group && <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-brand-300">{g.group}</div>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = isActive(pathname, it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${active ? "bg-brand-600 text-white" : "text-brand-100 hover:bg-brand-700"}`}
                  >
                    <span aria-hidden className="w-5 text-center">{it.icon}</span>
                    <span className="flex-1">{it.label}</span>
                    {it.href === "/reminders" && reminders > 0 && (
                      <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{reminders}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  children,
  companyName,
  reminders,
  logout,
}: {
  children: React.ReactNode;
  companyName: string;
  reminders: number;
  logout: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-brand-900 lg:flex">
        <div className="border-b border-brand-800 px-4 py-4">
          <div className="text-xs text-brand-300">نظام إدارة المصنع</div>
          <div className="truncate text-base font-bold text-white">{companyName}</div>
        </div>
        <NavList pathname={pathname} reminders={reminders} />
        <div className="mt-auto border-t border-brand-800 p-3">{logout}</div>
      </aside>

      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="القائمة">
          <button className="absolute inset-0 bg-black/40" aria-label="إغلاق القائمة" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-brand-900">
            <div className="flex items-center justify-between border-b border-brand-800 px-4 py-3">
              <span className="font-bold text-white">{companyName}</span>
              <button className="btn btn-ghost text-white hover:bg-brand-700" onClick={() => setOpen(false)} aria-label="إغلاق">✕</button>
            </div>
            <NavList pathname={pathname} reminders={reminders} onNavigate={() => setOpen(false)} />
            <div className="mt-auto border-t border-brand-800 p-3">{logout}</div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)} aria-label="فتح القائمة" aria-expanded={open}>☰ القائمة</button>
          <span className="truncate text-sm font-bold text-brand-800">{companyName}</span>
          <Link href="/reminders" className="btn btn-ghost btn-sm" aria-label="التذكيرات">
            🔔{reminders > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{reminders}</span>}
          </Link>
        </header>
        <main className="print-full mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
