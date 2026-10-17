import { PartyList } from "@/components/party-pages";
import type { SearchParams } from "@/components/table";

export const metadata = { title: "الموردون" };

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <PartyList kind="supplier" searchParams={searchParams} />;
}
