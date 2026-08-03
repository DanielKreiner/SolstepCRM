import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AngebotEntwurf } from "../AngebotEntwurf";

export const metadata: Metadata = { title: "Angebot erstellen" };

/*
 * Eigene Seite zum Erstellen, nicht ein Formular in der Liste.
 *
 * Ein Angebot hat Positionen, Mengen, Preise und einen Kunden — das passt
 * nicht in eine aufklappbare Karte neben einer Tabelle. Der Aufbau folgt
 * dem, was man aus Shopify kennt: links die Positionen mit ihren Summen,
 * rechts Kunde und Nebenangaben, unten die Zahlenspalte.
 *
 * Der Entwurf lebt im Browser, bis er abgeschickt wird. Erst dann entsteht
 * ein Datensatz — sonst sammeln sich leere Angebote an, sobald jemand die
 * Seite aufruft und wieder verlässt.
 */
export default async function AngebotNeuPage() {
  const me = await requireMe();
  if (me.perms.angebote !== "write") redirect("/angebote");

  const supabase = await createClient();
  const [{ data: kunden }, { data: artikel }] = await Promise.all([
    supabase
      .from("customer")
      .select("id, name, city, email")
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("article")
      .select("id, sku, name, unit, purchase_price, sale_price, vat_rate, image_url")
      .eq("active", true)
      .order("name"),
  ]);

  return (
    <>
      <PageHeader
        title="Angebot erstellen"
        subtitle="Positionen zusammenstellen, Kunde wählen, Angebot anlegen."
      />

      <AngebotEntwurf
        kunden={(kunden ?? []).map((k) => ({
          id: k.id as string,
          name: k.name as string,
          ort: (k.city as string | null) ?? null,
          email: (k.email as string | null) ?? null,
        }))}
        artikel={(artikel ?? []).map((a) => ({
          id: a.id as string,
          sku: a.sku as string,
          name: a.name as string,
          unit: a.unit as string,
          ek: Number(a.purchase_price),
          vk: Number(a.sale_price),
          ust: Number(a.vat_rate),
          bild: (a.image_url as string | null) ?? null,
        }))}
      />
    </>
  );
}
