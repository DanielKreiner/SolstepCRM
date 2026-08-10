import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/Button";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Planer" };

/*
 * Projektliste des Planers (Briefing 8.3).
 *
 * Kartenraster statt Tabelle: ein Planungsprojekt erkennt man am Dach,
 * nicht am Namen. Das Vorschaubild entsteht ab Stufe 6 beim Speichern;
 * bis dahin steht dort die Adresse.
 */

interface Zeile {
  id: string;
  name: string;
  adresse: string | null;
  kwp: number;
  status: string;
  updated_at: string;
}

export default async function PlanerPage() {
  const me = await requireMe();

  /*
   * Monteur und Lager haben auf 'planer' kein Recht und sollen den
   * Planer gar nicht kennen — 404 statt „kein Zugriff". Ein
   * Zugriffsfehler verrät, dass es die Seite gibt.
   */
  if (me.perms.planer === "none") notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("planer_projekt")
    .select("id, name, adresse, kwp, status, updated_at")
    .order("updated_at", { ascending: false });

  const projekte = (data as Zeile[] | null) ?? [];
  const darfSchreiben = me.perms.planer === "write";

  return (
    <div>
      <PageHeader
        title="Planer"
        subtitle="Von der Adresse zur geprüften Anlage — Dachflächen, Belegung, Ertrag."
        actions={
          darfSchreiben ? <LinkButton href="/planer/neu">Neues Projekt</LinkButton> : undefined
        }
      />

      {projekte.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-[14.5px] font-semibold">Noch keine Planung</p>
          <p className="mt-1.5 text-[13px] text-muted">
            Ein Projekt beginnt mit der Adresse. Danach wird das Dach gezeichnet.
          </p>
          {darfSchreiben ? (
            <div className="mt-4">
              <LinkButton href="/planer/neu">Erstes Projekt anlegen</LinkButton>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projekte.map((p) => (
            <li key={p.id}>
              <Link
                href={`/planer/${p.id}`}
                className="block overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-accent"
              >
                <div className="flex h-28 items-center justify-center bg-sunk">
                  <span className="mono text-[12px] text-muted">
                    {p.kwp > 0 ? `${p.kwp.toString().replace(".", ",")} kWp` : "noch keine Belegung"}
                  </span>
                </div>
                <div className="p-3.5">
                  <p className="truncate text-[14px] font-semibold">{p.name}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-muted">
                    {p.adresse ?? "ohne Adresse"}
                  </p>
                  <p className="mono mt-2 text-[11px] text-muted/80">
                    {p.status === "uebergeben" ? "übergeben" : "Entwurf"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
