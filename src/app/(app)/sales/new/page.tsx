import Link from "next/link";
import { PageHeader, Section, Alert } from "@/components/ui";
import { DocForm } from "@/components/doc-form";
import { accountOptions, customerOptions, itemOptions } from "@/lib/options";
import { saveSaleAction } from "../actions";

export const metadata = { title: "فاتورة بيع جديدة" };

export default async function NewSalePage() {
  const [customers, items, accounts] = await Promise.all([customerOptions(), itemOptions("FINISHED", { includeStock: true, priceFrom: "sale" }), accountOptions()]);
  return (
    <div>
      <PageHeader title="فاتورة بيع جديدة" crumbs={[{ label: "المبيعات", href: "/sales" }, { label: "جديدة" }]} />
      {items.length === 0 && <div className="mb-4"><Alert tone="warn">لا توجد منتجات تامة. <Link className="underline" href="/items/new?type=FINISHED">أضف منتجاً</Link> وأنتجه أولاً.</Alert></div>}
      <Section title="بيانات الفاتورة">
        <DocForm action={saveSaleAction} kind="sale" parties={customers} options={items} accounts={accounts} />
      </Section>
    </div>
  );
}
