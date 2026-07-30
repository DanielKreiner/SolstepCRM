import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Einsatzplanung" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Einsatzplanung" milestone={6} scope="Wochenplanung je Monteur mit Konfliktprüfung gegen die Arbeitsrechtsregeln." />;
}
