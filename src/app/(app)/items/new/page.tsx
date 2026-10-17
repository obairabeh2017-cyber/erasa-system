import { PageHeader, Section } from "@/components/ui";
import { categoryOptions, unitOptions } from "@/lib/options";
import { ItemForm } from "../item-form";
import { createItem } from "../actions";
import { sp, type SearchParams } from "@/components/table";

export const metadata = { title: "صنف جديد" };

export default async function NewItemPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const [units, categories] = await Promise.all([unitOptions(), categoryOptions("ITEM")]);
  return (
    <div>
      <PageHeader title="صنف جديد" crumbs={[{ label: "الأصناف", href: "/items" }, { label: "جديد" }]} />
      <Section title="بيانات الصنف">
        <ItemForm action={createItem} units={units} categories={categories} defaultType={sp(params, "type") === "FINISHED" ? "FINISHED" : "RAW"} />
      </Section>
    </div>
  );
}
