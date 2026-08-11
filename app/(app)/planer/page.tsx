import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton } from "@/components/ui/Button";
import { ProjektKarte } from "./ProjektKarte";
import { Suche } from "./Suche";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Planer" };

/*
 * Projektliste des Planers (Briefing 8.3).
 *
 * Kartenraster statt Tabelle: ein Planungsprojekt erkennt man am Dach,
 * nicht am Namen. Das Vorschaubild entsteht beim Wechsel in die
 * Übergabe — wo es fehlt, stehen die Kennzahlen an seiner Stelle.
 */

interface Zeile {
  id: string;
  name: string;
  adresse: string | null;
  kwp: number | string | null;
  status: string;
  vorschau_pfad: string | null;
  vorgang_id: string | null;
  updated_at: string;
}

export default async function PlanerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await requireMe();

  /*
   * Monteur und Lager haben auf 'planer' kein Recht und sollen den
   * Planer gar nicht kennen — 404 statt „kein Zugriff". Ein
   * Zugriffsfehler verrät, dass es die Seite gibt.
   */
  if (me.perms.planer === "none") notFound();

  const { q } = await searchParams;
  const suche = (q ?? "").trim();

  const supabase = await createClient();
  let abfrage = supabase
    .from("planer_projekt")
    .select("id, name, adresse, kwp, status, vorschau_pfad, vorgang_id, updated_at")
    .order("updated_at", { ascending: false });

  /*
   * Gesucht wird in Name UND Adresse. Wer ein Projekt sucht, hat
   * entweder den Kundennamen oder die Strasse im Kopf — welches von
   * beidem, weiss er selbst nicht immer.
   */
  if (suche) {
    const muster = `%${suche.replace(/[%_]/g, "")}%`;
    abfrage = abfrage.or(`name.ilike.${muster},adresse.ilike.${muster}`);
  }

  const { data } = await abfrage;
  const projekte = (data as Zeile[] | null) ?? [];
  const darfSchreiben = me.perms.planer === "write";

  /*
   * Vorschaubilder liegen im privaten Bucket — auf ihnen ist das Haus
   * eines namentlich bekannten Kunden zu sehen. Der Browser bekommt
   * befristet signierte Adressen, keine dauerhaften.
   */
  const pfade = projekte.map((p) => p.vorschau_pfad).filter((p): p is string => Boolean(p));
  const bilder = new Map<string, string>();
  if (pfade.length > 0) {
    const { data: signiert } = await supabase.storage
      .from("planer-fotos")
      .createSignedUrls(pfade, 60 * 60 * 4);
    for (const s of signiert ?? []) {
      if (s.path && s.signedUrl) bilder.set(s.path, s.signedUrl);
    }
  }

  /* Vorgangsnummern für den Status „übergeben als V-…". */
  const vorgangIds = projekte.map((p) => p.vorgang_id).filter((v): v is string => Boolean(v));
  const nummern = new Map<string, string>();
  if (vorgangIds.length > 0) {
    const { data: vorgaenge } = await supabase
      .from("vorgang")
      .select("id, number")
      .in("id", vorgangIds);
    for (const v of (vorgaenge ?? []) as Array<{ id: string; number: string }>) {
      nummern.set(v.id, v.number);
    }
  }

  return (
    <div>
      <PageHeader
        title="Planer"
        subtitle="Von der Adresse zur geprüften Anlage — Dachflächen, Belegung, Ertrag."
        actions={
          darfSchreiben ? <LinkButton href="/planer/neu">Neues Projekt</LinkButton> : undefined
        }
      />

      {(projekte.length > 0 || suche) && <Suche start={suche} />}

      {projekte.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-[14.5px] font-semibold">
            {suche ? "Nichts gefunden" : "Noch keine Planung"}
          </p>
          <p className="mt-1.5 text-[13px] text-muted">
            {suche
              ? "Gesucht wird in Projektname und Adresse."
              : "Ein Projekt beginnt mit der Adresse. Danach wird das Dach gezeichnet."}
          </p>
          {darfSchreiben && !suche ? (
            <div className="mt-4">
              <LinkButton href="/planer/neu">Erstes Projekt anlegen</LinkButton>
            </div>
          ) : null}
          {suche ? (
            <div className="mt-4">
              <Link href="/planer" className="text-[13px] text-accent-ink hover:underline">
                Suche zurücksetzen
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projekte.map((p) => (
            <li key={p.id}>
              <ProjektKarte
                id={p.id}
                name={p.name}
                adresse={p.adresse}
                kwp={Number(p.kwp ?? 0)}
                bild={p.vorschau_pfad ? (bilder.get(p.vorschau_pfad) ?? null) : null}
                vorgangNummer={p.vorgang_id ? (nummern.get(p.vorgang_id) ?? null) : null}
                vorgangId={p.vorgang_id}
                schreibrecht={darfSchreiben}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
