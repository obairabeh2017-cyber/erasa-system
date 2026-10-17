import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader, Money, StatusBadge, EmptyState, Badge } from "@/components/ui";
import { FilterBar, Pagination, SortTh, listParams, sp, type SearchParams } from "@/components/table";
import { dateRange, formatDate, isDateInput } from "@/lib/dates";
import { sum } from "@/lib/money";

export const metadata = { title: "المصروفات" };
const SORTS = ["number", "date", "amount"] as const;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { q, page, sort, dir, skip, take } = listParams(params, SORTS, "date");
  const categoryId = Number(sp(params, "categoryId")) || undefined;
  const status = sp(params, "status");
  const from = sp(params, "from");
  const to = sp(params, "to");
  const range = isDateInput(from) && isDateInput(to) ? dateRange(from, to) : null;
  const where: Prisma.ExpenseWhereInput = {
    ...(q ? { OR: [{ number: { contains: q } }, { description: { contains: q } }, { notes: { contains: q } }] } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { status } : {}),
    ...(range ? { date: { gte: range.start, lt: range.end } } : {}),
  };
  const [rows, total, categories, agg] = await Promise.all([
    prisma.expense.findMany({ where, include: { category: true, paidByEmployee: true, allocations: { where: { payment: { status: "POSTED" } } } }, orderBy: [{ [sort]: dir }, { id: "desc" }], skip, take }),
    prisma.expense.count({ where }),
    prisma.category.findMany({ where: { kind: "EXPENSE" }, orderBy: { name: "asc" } }),
    prisma.expense.aggregate({ where: { ...where, status: "POSTED" }, _sum: { amount: true } }),
  ]);
  return (
    <div>
      <PageHeader
        title="المصروفات"
        crumbs={[{ label: "المصروفات" }]}
        subtitle="المصروف يُسجّل عند حدوثه مرة واحدة، وسداده حركة نقدية منفصلة. المشتريات المخزنية ليست مصروفات."
        actions={<><Link href="/expenses/recurring" className="btn btn-secondary">المصروفات الدورية</Link><Link href="/expenses/new" className="btn btn-primary">+ مصروف</Link></>}
      />
      <FilterBar base="/expenses" q={q} placeholder="الرقم أو الوصف" exportHref="/api/export/expenses">
        <select name="categoryId" defaultValue={categoryId ?? ""} className="input w-auto" aria-label="الفئة"><option value="">كل الفئات</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="status" defaultValue={status} className="input w-auto" aria-label="الحالة"><option value="">كل الحالات</option><option value="POSTED">مُرحّل</option><option value="VOIDED">ملغى</option></select>
        <input type="date" name="from" defaultValue={from} className="input w-auto" aria-label="من تاريخ" />
        <input type="date" name="to" defaultValue={to} className="input w-auto" aria-label="إلى تاريخ" />
      </FilterBar>
      <p className="mb-2 text-sm text-stone-600">إجمالي المصروفات المُرحّلة ضمن التصفية: <Money value={agg._sum.amount ?? 0} className="font-bold" /></p>
      {rows.length === 0 ? <EmptyState title="لا توجد مصروفات" action={<Link href="/expenses/new" className="btn btn-primary">تسجيل مصروف</Link>} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh base="/expenses" params={params} field="number" label="الرقم" current={sort} dir={dir} />
                <SortTh base="/expenses" params={params} field="date" label="التاريخ" current={sort} dir={dir} />
                <th>الفئة</th><th>الوصف</th>
                <SortTh base="/expenses" params={params} field="amount" label="المبلغ" current={sort} dir={dir} />
                <th>السداد</th><th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const paid = sum(e.allocations.map((a) => a.amount));
                return (
                  <tr key={e.id}>
                    <td><Link href={`/expenses/${e.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{e.number}</Link></td>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.category.name}</td>
                    <td className="max-w-xs truncate">{e.description}{e.receiptPath && " 📎"}</td>
                    <td><Money value={e.amount} /></td>
                    <td>
                      {e.status !== "POSTED" ? "—" : e.paidByEmployee ? <Badge tone="blue">دفعه {e.paidByEmployee.name}</Badge> : paid >= e.amount ? <Badge tone="green">مسدد</Badge> : <Badge tone="amber">متبقي <Money value={e.amount - paid} /></Badge>}
                    </td>
                    <td><StatusBadge status={e.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base="/expenses" params={params} page={page} total={total} />
    </div>
  );
}
