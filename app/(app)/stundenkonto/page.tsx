import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Stundenkonto" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Stundenkonto" milestone={10} scope="Saldo je Mitarbeiter, Zeitausgleich, Auszahlung und Korrekturworkflow." />;
}
