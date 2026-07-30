import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Berichte" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Berichte" milestone={11} scope="Auswertungen mit Export nach Excel und PDF." />;
}
