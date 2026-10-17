import Link from "next/link";
import { PageHeader, Section, Alert } from "@/components/ui";
import { DocForm } from "@/components/doc-form";
import { accountOptions, itemOptions, supplierOptions } from "@/lib/options";
import { savePurchaseAction } from "../actions";

export const metadata = { title: "فاتورة شراء جديدة" };

export default async function NewPurchasePage() {
  const [suppliers, items, accounts] = await Promise.all([supplierOptions(), itemOptions(undefined, { priceFrom: "cost" }), accountOptions()]);
  return (
    <div>
      <PageHeader title="فاتورة شراء جديدة" crumbs={[{ label: "المشتريات", href: "/purchases" }, { label: "جديدة" }]} />
      {suppliers.length === 0 && <div className="mb-4"><Alert tone="warn">لا يوجد موردون. <Link className="underline" href="/suppliers">أضف مورّداً</Link> أولاً.</Alert></div>}
      <Section title="بيانات الفاتورة">
        <DocForm action={savePurchaseAction} kind="purchase" parties={suppliers} options={items} accounts={accounts} />
      </Section>
    </div>
  );
}
