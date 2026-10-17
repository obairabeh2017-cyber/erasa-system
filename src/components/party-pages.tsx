import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader, Section, Money, StatusBadge, EmptyState, Badge, Stat } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PaymentFields } from "@/components/payment-fields";
import { FilterBar, Pagination, listParams, type SearchParams } from "@/components/table";
import { formatDate, todayInput, diffLocalDays } from "@/lib/dates";
import { sum } from "@/lib/money";
import { PAYMENT_KIND } from "@/lib/labels";
import { accountOptions } from "@/lib/options";
import { createCustomer, createSupplier, partyPaymentAction, updateCustomer, updateSupplier } from "@/app/(app)/parties-actions";

type Kind = "customer" | "supplier";
const T = {
  customer: { title: "الزبائن", one: "زبون", base: "/customers", docBase: "/sales", balance: "المستحق على الزبون", pay: "استلام دفعة من الزبون" },
  supplier: { title: "الموردون", one: "مورّد", base: "/suppliers", docBase: "/purchases", balance: "المستحق للمورّد", pay: "دفع مبلغ للمورّد" },
};

function PartyFields({ party }: { party?: { name: string; phone: string | null; address: string | null; notes: string | null; active: boolean } }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div><label className="label" htmlFor="p-name">الاسم *</label><input id="p-name" name="name" className="input" required defaultValue={party?.name} /></div>
      <div><label className="label" htmlFor="p-phone">الهاتف</label><input id="p-phone" name="phone" className="input" dir="ltr" defaultValue={party?.phone ?? ""} /></div>
      <div><label className="label" htmlFor="p-address">العنوان</label><input id="p-address" name="address" className="input" defaultValue={party?.address ?? ""} /></div>
      <div><label className="label" htmlFor="p-notes">ملاحظات</label><input id="p-notes" name="notes" className="input" defaultValue={party?.notes ?? ""} /></div>
      {party && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={party.active} className="size-4" /> نشط</label>}
    </div>
  );
}

async function balances(kind: Kind) {
  if (kind === "customer") {
    const sales = await prisma.sale.findMany({
      where: { status: "POSTED", customerId: { not: null } },
      include: { returns: { where: { status: "POSTED" } }, allocations: { where: { payment: { status: "POSTED" } }, include: { payment: true } } },
    });
    const m = new Map<number, number>();
    for (const s of sales) {
      const paid = sum(s.allocations.map((a) => (a.payment.direction === "IN" ? a.amount : -a.amount)));
      m.set(s.customerId!, (m.get(s.customerId!) ?? 0) + s.total - sum(s.returns.map((r) => r.total)) - paid);
    }
    return m;
  }
  const ps = await prisma.purchase.findMany({ where: { status: "POSTED" }, include: { allocations: { where: { payment: { status: "POSTED" } } } } });
  const m = new Map<number, number>();
  for (const p of ps) m.set(p.supplierId, (m.get(p.supplierId) ?? 0) + p.total - sum(p.allocations.map((a) => a.amount)));
  return m;
}

export async function PartyList({ kind, searchParams }: { kind: Kind; searchParams: Promise<SearchParams> }) {
  const t = T[kind];
  const params = await searchParams;
  const { q, page, skip, take } = listParams(params, ["name"] as const, "name", "asc");
  const where = q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {};
  const query = { where, orderBy: { name: "asc" as const }, skip, take };
  const [rows, total, bal] = await Promise.all([
    kind === "customer" ? prisma.customer.findMany(query) : prisma.supplier.findMany(query),
    kind === "customer" ? prisma.customer.count({ where }) : prisma.supplier.count({ where }),
    balances(kind),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title={t.title} crumbs={[{ label: t.title }]} />
      <FilterBar base={t.base} q={q} placeholder="بحث بالاسم أو الهاتف" exportHref={`/api/export/${kind === "customer" ? "customers" : "suppliers"}`} />
      {rows.length === 0 ? (
        <EmptyState title={`لا يوجد ${t.title}`} hint="استخدم النموذج أدناه للإضافة." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th>{t.balance}</th><th>الحالة</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`${t.base}/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name}</Link></td>
                  <td dir="ltr" className="text-end">{r.phone ?? "—"}</td>
                  <td>{r.address ?? "—"}</td>
                  <td><Money value={bal.get(r.id) ?? 0} className={(bal.get(r.id) ?? 0) > 0 ? "font-semibold text-red-700" : ""} /></td>
                  <td>{r.active ? <Badge tone="green">نشط</Badge> : <Badge>غير نشط</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base={t.base} params={params} page={page} total={total} />
      <Section title={`إضافة ${t.one}`}>
        <ActionForm action={kind === "customer" ? createCustomer : createSupplier} className="space-y-3">
          <PartyFields />
          <SubmitButton>إضافة</SubmitButton>
        </ActionForm>
      </Section>
    </div>
  );
}

export async function PartyDetail({ kind, id }: { kind: Kind; id: number }) {
  const t = T[kind];
  const party =
    kind === "customer" ? await prisma.customer.findUnique({ where: { id } }) : await prisma.supplier.findUnique({ where: { id } });
  if (!party) notFound();
  const accounts = await accountOptions();
  const docs =
    kind === "customer"
      ? (
          await prisma.sale.findMany({
            where: { customerId: id },
            include: { returns: { where: { status: "POSTED" } }, allocations: { where: { payment: { status: "POSTED" } }, include: { payment: true } } },
            orderBy: { date: "desc" },
          })
        ).map((s) => {
          const paid = sum(s.allocations.map((a) => (a.payment.direction === "IN" ? a.amount : -a.amount)));
          const net = s.total - sum(s.returns.map((r) => r.total));
          return { id: s.id, number: s.number, date: s.date, dueDate: s.dueDate, status: s.status, total: net, paid, remaining: s.status === "POSTED" ? net - paid : 0 };
        })
      : (
          await prisma.purchase.findMany({ where: { supplierId: id }, include: { allocations: { where: { payment: { status: "POSTED" } } } }, orderBy: { date: "desc" } })
        ).map((p) => {
          const paid = sum(p.allocations.map((a) => a.amount));
          return { id: p.id, number: p.number, date: p.date, dueDate: p.dueDate, status: p.status, total: p.total, paid, remaining: p.status === "POSTED" ? p.total - paid : 0 };
        });
  const payments = await prisma.payment.findMany({
    where: kind === "customer" ? { customerId: id } : { supplierId: id },
    include: { allocations: true, account: true },
    orderBy: { date: "desc" },
  });
  const unallocated = sum(payments.filter((p) => p.status === "POSTED").map((p) => p.amount - sum(p.allocations.map((a) => a.amount))));
  const owed = sum(docs.map((d) => d.remaining));
  const now = new Date();

  return (
    <div className="space-y-5">
      <PageHeader title={party.name} crumbs={[{ label: t.title, href: t.base }, { label: party.name }]} actions={<Link href={`${t.docBase}/new`} className="btn btn-primary">+ فاتورة جديدة</Link>} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t.balance} value={<Money value={owed} />} tone={owed > 0 ? "warn" : "default"} />
        <Stat label="دفعات غير مخصصة (رصيد دائن)" value={<Money value={unallocated} />} hint={unallocated > 0 ? "يمكن تخصيصها من صفحة الدفعة" : undefined} />
        <Stat label="الصافي" value={<Money value={owed - unallocated} />} />
      </div>
      <Section title="الفواتير">
        {docs.length === 0 ? <p className="text-sm text-stone-500">لا توجد فواتير.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الرقم</th><th>التاريخ</th><th>الاستحقاق</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>التأخير</th><th>الحالة</th></tr></thead>
              <tbody>
                {docs.map((d) => {
                  const late = d.remaining > 0 && d.dueDate ? diffLocalDays(d.dueDate, now) : 0;
                  return (
                    <tr key={d.id}>
                      <td><Link href={`${t.docBase}/${d.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{d.number}</Link></td>
                      <td>{formatDate(d.date)}</td>
                      <td>{formatDate(d.dueDate)}</td>
                      <td><Money value={d.total} /></td>
                      <td>{d.status === "POSTED" ? <Money value={d.paid} /> : "—"}</td>
                      <td>{d.status === "POSTED" ? <Money value={d.remaining} className={d.remaining > 0 ? "text-red-700" : ""} /> : "—"}</td>
                      <td>{late > 0 ? <Badge tone="red">{late} يوم</Badge> : "—"}</td>
                      <td><StatusBadge status={d.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title={t.pay}>
        <ActionForm action={partyPaymentAction} className="space-y-3" resetOnSuccess>
          <input type="hidden" name="partyKind" value={kind} />
          <input type="hidden" name="partyId" value={id} />
          <PaymentFields accounts={accounts} requireAmount />
          <div className="flex flex-wrap items-end gap-4">
            <div><label className="label" htmlFor="pp-date">التاريخ</label><input id="pp-date" name="date" type="date" className="input" defaultValue={todayInput()} /></div>
            <div className="min-w-48 flex-1"><label className="label" htmlFor="pp-notes">ملاحظات</label><input id="pp-notes" name="notes" className="input" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoAllocate" defaultChecked className="size-4" /> تخصيص تلقائي على أقدم الفواتير</label>
            <SubmitButton>تسجيل الدفعة</SubmitButton>
          </div>
        </ActionForm>
      </Section>
      <Section title="سجل الدفعات">
        {payments.length === 0 ? <p className="text-sm text-stone-500">لا توجد دفعات.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>الحساب</th><th>المبلغ</th><th>غير مخصص</th><th>الحالة</th></tr></thead>
              <tbody>
                {payments.map((p) => {
                  const un = p.amount - sum(p.allocations.map((a) => a.amount));
                  return (
                    <tr key={p.id} className={p.status === "VOIDED" ? "opacity-60" : ""}>
                      <td><Link href={`/payments/${p.id}`} className="font-mono text-brand-700 hover:underline" dir="ltr">{p.number}</Link></td>
                      <td>{formatDate(p.date)}</td>
                      <td>{PAYMENT_KIND[p.kind] ?? p.kind}</td>
                      <td>{p.account.name}</td>
                      <td><Money value={p.amount} /></td>
                      <td>{p.status === "POSTED" && un > 0 ? <Money value={un} className="text-amber-700" /> : "—"}</td>
                      <td>{p.status === "VOIDED" ? <Badge>ملغاة</Badge> : <Badge tone="green">مُرحّلة</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="تعديل البيانات">
        <ActionForm action={kind === "customer" ? updateCustomer : updateSupplier} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <PartyFields party={party} />
          <SubmitButton>حفظ</SubmitButton>
        </ActionForm>
      </Section>
    </div>
  );
}
