import { PartyDetail } from "@/components/party-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartyDetail kind="customer" id={Number(id)} />;
}
