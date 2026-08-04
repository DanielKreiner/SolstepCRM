import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Planung } from "@/components/planung/Planung";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { kalenderwoche, tafelLaden } from "@/lib/einsatz/daten";
import { viennaDay } from "@/lib/format";
import { addDays, startOfViennaWeek } from "@/lib/time";

export const metadata: Metadata = { title: "Planung" };

/**
 * Die Plantafel.
 *
 * Zentrale Einheit ist der Einsatz und nicht der Auftrag: ein Block Zeit
 * von einer oder mehreren Personen, der auf einen Vorgang zeigen KANN.
 * Damit ist „Lager aufräumen" planbar, ohne einen Scheinvorgang
 * anzulegen — und ein Servicetag ohne Auftrag auch.
 *
 * Terminieren im Vorgang und Verschieben hier sind ZWEI SICHTEN AUF
 * DENSELBEN EINSATZ. Nie zwei Kalender, nie eine Kopie: sonst steht in
 * der Tafel ein neuer Termin und im Vorgang der alte, und der Kunde
 * bekommt am Telefon zwei Auskünfte.
 *
 * Abwesenheiten stehen in derselben Tafel. Ohne sie wäre die
 * Konfliktprüfung wertlos, weil niemand sieht, warum sie anschlägt.
 */
export default async function PlanungPage({
  searchParams,
}: {
  searchParams: Promise<{ woche?: string; vorgang?: string }>;
}) {
  const me = await requireMe();
  const { woche, vorgang } = await searchParams;
  const supabase = await createClient();

  const montagIso = startOfViennaWeek(
    woche && /^\d{4}-\d{2}-\d{2}$/.test(woche) ? woche : viennaDay(),
  );

  /*
   * Fünf Spalten, nicht sieben. Ein PV-Betrieb plant Montag bis Freitag;
   * das Wochenende würde zwei Achtel der Breite für leere Zellen
   * verbrauchen. Samstagsarbeit gibt es — sie wird dann über den Dialog
   * angelegt und in der Folgewoche sichtbar.
   */
  const tage = Array.from({ length: 5 }, (_, i) => addDays(montagIso, i));

  const von = new Date(`${montagIso}T00:00:00`);
  const bis = new Date(`${addDays(montagIso, 7)}T00:00:00`);

  const tafel = await tafelLaden(supabase, von, bis);

  /*
   * Vorgänge für die Auswahl im Dialog. Nur laufende: einen
   * abgeschlossenen Auftrag neu zu terminieren ergibt keinen Sinn, und
   * die Liste bliebe sonst über die Jahre nicht bedienbar.
   */
  const { data: vorgaenge } = await supabase
    .from("vorgang")
    .select("id, number, phase, customer:customer_id ( name )")
    .in("phase", ["aufnahme", "angebot", "beauftragt", "montage"])
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: quals } = await supabase
    .from("qualifikation")
    .select("schluessel, label")
    .order("sort");

  const darfPlanen = me.perms.pipelines === "write";
  const sonntag = new Date(`${addDays(montagIso, 6)}T00:00:00`);

  return (
    <>
      <PageHeader
        title="Plantafel"
        subtitle={`Der Einsatz ist die Planungseinheit · KW ${kalenderwoche(von)} · ${von.toLocaleDateString(
          "de-AT",
          { day: "2-digit", month: "2-digit" },
        )}–${sonntag.toLocaleDateString("de-AT", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}${darfPlanen ? " · leere Zelle klicken legt einen Einsatz an" : ""}`}
      />

      <Planung
        woche={montagIso}
        tage={tage}
        personen={tafel.personen}
        fahrzeuge={tafel.fahrzeuge}
        bloecke={tafel.einsaetze.map((e) => ({
          id: e.id,
          art: e.art,
          titel: e.titel,
          von: e.von,
          bis: e.bis,
          ganztaegig: e.ganztaegig,
          personen: e.personen,
          fahrzeugId: e.fahrzeugId,
          vorgangId: e.vorgangId,
          vorgangNummer: e.vorgangNummer,
          anzahlStopps: e.anzahlStopps,
          notiz: e.notiz,
        }))}
        abwesenheiten={tafel.abwesenheiten}
        vorgaenge={((vorgaenge ?? []) as unknown as {
          id: string;
          number: string;
          customer: { name: string } | null;
        }[]).map((v) => ({
          wert: v.id,
          text: `${v.number} · ${v.customer?.name ?? "ohne Kunde"}`,
        }))}
        qualifikationen={((quals ?? []) as unknown as {
          schluessel: string;
          label: string;
        }[]).map((q) => ({ wert: q.schluessel, text: q.label }))}
        darfPlanen={darfPlanen}
        vorgangVorbelegt={vorgang ?? null}
      />
    </>
  );
}
