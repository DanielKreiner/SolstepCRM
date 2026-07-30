import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Dokumente" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Dokumente" milestone={10} scope="Verträge, Zertifikate und Lohnzettel mit Signaturstatus." />;
}
