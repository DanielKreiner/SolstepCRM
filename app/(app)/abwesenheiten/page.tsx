import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Abwesenheiten" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Abwesenheiten" milestone={10} scope="Jahresplaner, Urlaubsantrag, Resturlaub und Krankenstand." />;
}
