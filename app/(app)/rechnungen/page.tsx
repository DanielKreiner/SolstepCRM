import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Rechnungen" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Rechnungen" milestone={7} scope="Teilrechnungen Anzahlung, Montage, Schluss sowie der automatische Mahnlauf." />;
}
