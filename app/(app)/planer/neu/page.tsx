import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireMe } from "@/lib/session";
import { NeuFormular } from "./NeuFormular";

export const metadata: Metadata = { title: "Neues Planer-Projekt" };

export default async function NeuesProjektPage() {
  const me = await requireMe();
  if (me.perms.planer !== "write") notFound();

  return (
    <div>
      <PageHeader
        title="Neues Projekt"
        subtitle="Mit der Adresse anfangen — der Rest entsteht auf der Karte."
      />
      <NeuFormular />
    </div>
  );
}
