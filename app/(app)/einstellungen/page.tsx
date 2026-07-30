import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Einstellungen" milestone={11} scope="Rollenmatrix, Phasen je Mandant, Nummernkreise, Postfach und Firmendaten." />;
}
