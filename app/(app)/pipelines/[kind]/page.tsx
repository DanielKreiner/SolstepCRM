import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Pipelines" };

const KINDS: Record<string, string> = {
  vertrieb: "Vertrieb",
  projekte: "Projekte",
  service: "Service",
};

export default async function Page({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  await requireMe();
  const { kind } = await params;
  const label = KINDS[kind];
  if (!label) notFound();

  return (
    <Placeholder
      title={`Pipeline ${label}`}
      milestone={2}
      scope="Board, Tabelle und Timeline über dieselbe Liste. Drag ändert die Phase serverseitig, Filter stehen in der URL."
    />
  );
}
