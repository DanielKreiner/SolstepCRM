import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Bewerber" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Bewerber" milestone={11} scope="Bewerberpipeline von der Sichtung bis zur Zusage." />;
}
