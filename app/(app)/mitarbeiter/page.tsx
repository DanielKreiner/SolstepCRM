import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Mitarbeiter" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Mitarbeiter" milestone={10} scope="Stammdaten, Qualifikationen mit Ablaufwarnung und Mitarbeiterdokumente." />;
}
