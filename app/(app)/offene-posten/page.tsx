import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, eur } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { stufenLabel } from "@/lib/rules/dunning";
import { MahnAktionen } from "./MahnAktionen";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Offene Posten" };

/**
 * Offene Posten — alle Rechnungen, die nicht bezahlt sind.
 *
 * Sortiert nach Fälligkeit, das Überfällige zuerst. Der Mahnlauf läuft
 * nachts über dieselbe Regel, die hier der Knopf befragt
 * (lib/rules/dunning.ts) — was die Liste zeigt, tut der Cron auch.
 *
 * Die Zeilen kommen aus vorgang_dokument. Rollen ohne Rechnungsrecht
 * bekommen von der Policy gar keine Zeile — die Seite ist dann leer und
 * nicht etwa gefiltert.
 */
export default async function OffenePostenPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const { data: belege } = await supabase
    .from("vorgang_dokument")
    .select(
      `id, typ, nummer, betrag_brutto, status, faellig_am, created_at,
       mahnstufe, gemahnt_am, mahnung_aktiv,
       vorgang:vorgang_id ( id, number, phase, customer:customer_id ( name ) )`,
    )
    .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
    .neq("status", "bezahlt")
    .neq("status", "storniert")
    .order("faellig_am", { nullsFirst: false });

  type Zeile = {
    id: string;
    typ: string;
    nummer: string | null;
    betrag_brutto: string | null;
    status: string | null;
    faellig_am: string | null;
    created_at: string;
    mahnstufe: number;
    gemahnt_am: string | null;
    mahnung_aktiv: boolean;
    vorgang: {
      id: string;
      number: string;
      phase: string;
      customer: { name: string } | null;
    } | null;
  };

  const alle = ((belege ?? []) as unknown as Zeile[]).filter((b) => b.vorgang);
  const heute = new Date();

  const ueberfaellig = alle.filter(
    (b) => b.faellig_am !== null && new Date(b.faellig_am) < heute,
  );
  const summe = alle.reduce((a, b) => a + Number(b.betrag_brutto ?? 0), 0);
  const summeUeberfaellig = ueberfaellig.reduce(
    (a, b) => a + Number(b.betrag_brutto ?? 0),
    0,
  );
  const entwuerfe = alle.filter((b) => b.status === "entwurf");
  const darfMahnen = me.perms.rechnungen === "write";

  return (
    <>
      <PageHeader
        title="Offene Posten"
        subtitle="Rechnungen, die noch nicht bezahlt sind"
      />

      {me.perms.rechnungen === "none" ? (
        <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
          Für Rechnungen fehlt deiner Rolle das Leserecht.
        </p>
      ) : (
        <>
          <div className="mb-4 grid gap-[10px] sm:grid-cols-3">
            <Stat label="Offen gesamt" value={eur(summe)} />
            <Stat
              label="Davon überfällig"
              value={
                summeUeberfaellig > 0 ? (
                  <span className="text-s-crit">{eur(summeUeberfaellig)}</span>
                ) : (
                  eur(0)
                )
              }
            />
            <Stat
              label="Noch nicht versendet"
              value={
                entwuerfe.length > 0 ? (
                  <span className="text-s-warn">{entwuerfe.length}</span>
                ) : (
                  "0"
                )
              }
            />
          </div>

          {alle.length === 0 ? (
            <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
              Nichts offen. Jede gestellte Rechnung ist bezahlt.
            </p>
          ) : (
            <ul className="flex flex-col gap-[10px]">
              {alle.map((b) => {
                const faellig = b.faellig_am ? new Date(b.faellig_am) : null;
                const tage = faellig
                  ? Math.floor((heute.getTime() - faellig.getTime()) / 86_400_000)
                  : null;
                const spaet = tage !== null && tage > 0;

                return (
                  <li key={b.id}>
                    <Link
                      href={`/vorgaenge/${b.vorgang!.id}`}
                      className="block rounded-[20px] bg-surface p-5 shadow-soft transition-colors hover:bg-panel"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num text-[13px] font-semibold">
                          {b.nummer ?? "ohne Nummer"}
                        </span>
                        <Pill
                          tone={
                            spaet
                              ? "crit"
                              : b.status === "entwurf"
                                ? "neutral"
                                : "warn"
                          }
                        >
                          {spaet
                            ? `${tage} ${tage === 1 ? "Tag" : "Tage"} überfällig`
                            : b.status === "entwurf"
                              ? "Entwurf"
                              : "versendet"}
                        </Pill>
                        <span className="text-[12px] text-muted">
                          {b.typ === "anzahlungsrechnung"
                            ? "Anzahlung"
                            : "Schlussrechnung"}
                        </span>
                        {stufenLabel(b.mahnstufe) ? (
                          <Pill tone="crit">{stufenLabel(b.mahnstufe)}</Pill>
                        ) : null}
                        {!b.mahnung_aktiv ? (
                          <Pill tone="neutral">Mahnlauf ausgesetzt</Pill>
                        ) : null}
                        <span className="num ml-auto text-[15px] font-semibold">
                          {eur(Number(b.betrag_brutto ?? 0))}
                        </span>
                      </div>

                      <p className="mt-2 text-[14px] font-medium">
                        {b.vorgang!.customer?.name ?? "—"}
                      </p>
                      <p className="num text-[12px] text-muted">
                        {b.vorgang!.number}
                        {b.faellig_am ? ` · fällig ${date(b.faellig_am)}` : ""}
                        {b.gemahnt_am ? ` · gemahnt ${date(b.gemahnt_am)}` : ""}
                      </p>
                    </Link>

                    {darfMahnen && b.status === "versendet" ? (
                      <div className="-mt-[10px] rounded-b-[20px] bg-surface px-5 pb-4 shadow-soft">
                        <MahnAktionen
                          dokumentId={b.id}
                          mahnungAktiv={b.mahnung_aktiv}
                          faellig={spaet}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-3 text-[11.5px] text-faint">
            Der Mahnlauf erinnert nach 7 Tagen, mahnt nach 21 und nach 35 —
            höchstens eine Stufe je Tag. Wer eine Ratenzahlung vereinbart
            hat, setzt ihn für diese Rechnung aus.
          </p>
        </>
      )}
    </>
  );
}
