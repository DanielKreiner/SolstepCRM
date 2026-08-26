import type { SupabaseClient } from "@supabase/supabase-js";
import type { BedarfPosition } from "@/lib/planer/uebergabe";

/*
 * Was die Planung ergibt, gehört ins Angebot.
 *
 * Die Übergabe aus dem Planer schrieb bisher nur die Bedarfsliste ins
 * Material. Fachlich richtig — nur bekam der Kunde davon nichts zu
 * sehen: Wer aus einer fertigen Planung einen Vorgang anlegte, stand
 * anschliessend vor einem leeren Angebot und tippte Wechselrichter,
 * Module und Speicher noch einmal ein. Genau die Doppelarbeit, die
 * dieses Produkt abschaffen soll.
 *
 * Kopiert, nicht verknüpft: Ein Angebot von heute darf sich nicht
 * ändern, weil jemand nächstes Jahr den Preis anhebt.
 *
 * Eine Datei, zwei Aufrufer — die Übergabe im Planer und der Knopf
 * „Aus der Planung übernehmen" im Angebot. Zwei Kopien wären zwei
 * Wahrheiten über den Preis.
 */

/**
 * Die Überschrift für die Anlage im Angebot.
 *
 * „PV-Anlage 9,4 kWp" — der Betrieb wollte es genau so: eine Gruppe,
 * unter der Wechselrichter, Module und Speicher zusammenstehen, mit der
 * Leistung im Namen. Ohne Leistung (noch kein Modul auf dem Dach)
 * bleibt der Name schlicht.
 */
export function anlagenGruppe(kwp: number): string {
  if (!(kwp > 0)) return "PV-Anlage";
  return `PV-Anlage ${kwp.toLocaleString("de-AT", { maximumFractionDigits: 2 })} kWp`;
}

export interface PositionenErgebnis {
  angelegt: number;
  /** Stand schon im Angebot — am Artikel erkannt, nicht am Namen. */
  uebersprungen: number;
  /** Ohne Artikel im Stamm, also ohne Preis. */
  ohnePreis: number;
  fehler: string | null;
}

export async function positionenSchreiben(
  supabase: SupabaseClient,
  opts: {
    companyId: string;
    vorgangId: string;
    /** Steuersatz des Vorgangs, für Zeilen ohne Artikel. */
    ustSatz: number;
    bedarf: BedarfPosition[];
    /**
     * Überschrift, unter der die Positionen im Angebot stehen.
     *
     * Wechselrichter, Module und Speicher gehören zusammen — sie sind
     * die Anlage. Einzeln untereinander liest der Kunde eine Liste
     * Bauteile; unter „PV-Anlage 9,4 kWp" liest er, was er kauft.
     */
    gruppenName?: string | null;
  },
): Promise<PositionenErgebnis> {
  const leer: PositionenErgebnis = { angelegt: 0, uebersprungen: 0, ohnePreis: 0, fehler: null };
  if (opts.bedarf.length === 0) return leer;

  /*
   * Was schon im Angebot steht, wird nicht doppelt angelegt. Verglichen
   * wird über den Artikel; für Zeilen ohne Artikel bleibt nur die
   * Bezeichnung, und die ist beim zweiten Durchlauf noch unverändert.
   */
  const { data: bestehende } = await supabase
    .from("vorgang_position")
    .select("article_id, bezeichnung, sort")
    .eq("vorgang_id", opts.vorgangId)
    .is("dokument_id", null);

  const artikelDa = new Set(
    (bestehende ?? [])
      .map((p) => p.article_id as string | null)
      .filter((x): x is string => !!x),
  );
  const namenDa = new Set((bestehende ?? []).map((p) => String(p.bezeichnung ?? "").trim()));
  let sort = Math.max(0, ...(bestehende ?? []).map((p) => Number(p.sort ?? 0))) + 10;

  const artikelIds = opts.bedarf
    .map((b) => b.artikel_id)
    .filter((x): x is string => typeof x === "string");
  const { data: artikel } = artikelIds.length
    ? await supabase
        .from("article")
        .select(
          "id, name, unit, purchase_price, sale_price, vat_rate, description, image_url, kalk_stunden_pro_einheit, ist_material",
        )
        .in("id", artikelIds)
    : { data: [] };

  const stamm = new Map((artikel ?? []).map((a) => [a.id as string, a]));

  const zeilen: Record<string, unknown>[] = [];
  const ergebnis: PositionenErgebnis = { ...leer };

  for (const b of opts.bedarf) {
    if (b.artikel_id ? artikelDa.has(b.artikel_id) : namenDa.has(b.bezeichnung.trim())) {
      ergebnis.uebersprungen++;
      continue;
    }
    const a = b.artikel_id ? stamm.get(b.artikel_id) : undefined;
    if (!a) ergebnis.ohnePreis++;

    zeilen.push({
      company_id: opts.companyId,
      vorgang_id: opts.vorgangId,
      sort: (sort += 10),
      article_id: a ? (a.id as string) : null,
      bezeichnung: (a?.name as string | undefined) ?? b.bezeichnung,
      menge: b.menge,
      einheit: (a?.unit as string | undefined) ?? b.einheit,
      ep_netto: a ? Number(a.sale_price ?? 0) : 0,
      ust_satz: a ? Number(a.vat_rate ?? 20) : opts.ustSatz,
      kalk_ek: a ? a.purchase_price : null,
      kalk_stunden: a ? a.kalk_stunden_pro_einheit : null,
      ist_material: a ? ((a.ist_material as boolean | null) ?? true) : true,
      bild_url: (a?.image_url as string | null | undefined) ?? null,
      beschreibung: a
        ? ((a.description as string | null | undefined) ?? null)
        : "Aus der Planung übernommen — im Material zuordnen und Preis nachtragen.",
    });
  }

  if (zeilen.length === 0) return ergebnis;

  /*
   * Die Gruppe entsteht erst, wenn es auch Positionen dafür gibt — eine
   * leere Überschrift im Angebot wäre schlimmer als keine. Gibt es sie
   * schon (zweite Übergabe), wird sie weiterverwendet.
   */
  const gruppeId = opts.gruppenName
    ? await gruppeHolen(supabase, opts.companyId, opts.vorgangId, opts.gruppenName)
    : null;
  if (gruppeId) for (const z of zeilen) z.gruppe_id = gruppeId;

  const { error } = await supabase.from("vorgang_position").insert(zeilen);
  if (error) return { ...ergebnis, fehler: error.message };
  return { ...ergebnis, angelegt: zeilen.length };
}

/** Die Gruppe dieses Namens — vorhanden oder neu. */
async function gruppeHolen(
  supabase: SupabaseClient,
  companyId: string,
  vorgangId: string,
  name: string,
): Promise<string | null> {
  /*
   * `limit(1)` statt `maybeSingle()`: Es kann dieselbe Überschrift
   * zweimal geben — von Hand angelegt oder aus einem früheren Stand.
   * `maybeSingle` wäre dann ein Fehler, und die Positionen landeten
   * ohne Gruppe im Angebot.
   */
  const { data: da } = await supabase
    .from("vorgang_gruppe")
    .select("id")
    .eq("vorgang_id", vorgangId)
    .is("dokument_id", null)
    .eq("name", name)
    .order("sort")
    .limit(1);
  const treffer = (da ?? [])[0];
  if (treffer) return treffer.id as string;

  const { data: bestand } = await supabase
    .from("vorgang_gruppe")
    .select("sort")
    .eq("vorgang_id", vorgangId)
    .is("dokument_id", null);
  const sort = Math.max(0, ...(bestand ?? []).map((g) => Number(g.sort ?? 0))) + 10;

  const { data: neu } = await supabase
    .from("vorgang_gruppe")
    .insert({ company_id: companyId, vorgang_id: vorgangId, name, sort })
    .select("id")
    .single();
  return (neu?.id as string | undefined) ?? null;
}
