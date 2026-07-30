import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Angebote" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Angebote" milestone={3} scope="Angebote mit Step-Planer-Import, PDF, Mailversand und digitaler Annahme." />;
}
