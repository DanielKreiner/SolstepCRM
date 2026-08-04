import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { materialGateSchreiben } from "@/lib/material/daten";

/**
 * Alle Bewegungen an einer Stelle.
 *
 * Wareneingang, Entnahme, Rückgabe, Umbuchung und Inventur laufen über
 * dieselben fünf Funktionen — egal ob sie aus der Lageransicht, der
 * Beladeliste des Monteurs oder dem Bestelldialog kommen. Eine zweite
 * Implementierung wäre eine zweite Rundungs- und Vorzeichenregel, und
 * die fällt erst auf, wenn der Bestand nicht mehr stimmt.
 *
 * Der EK schreibt sich selbst: der Trigger holt ihn aus dem
 * Artikelstamm. Keine dieser Funktionen übergibt ihn.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type Ergebnis = { ok: true; hinweis?: string } | { ok: false; grund: string };

/** Der Lagerort „Hauptlager" des Mandanten. */
export async function hauptlager(
  supabase: Client,
  companyId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("lagerort")
    .select("id")
    .eq("company_id", companyId)
    .eq("art", "hauptlager")
    .limit(1)
    .maybeSingle();
  return (data?.id as string | null) ?? null;
}

/* ------------------------------------------------------ WARENEINGANG */

export type EingangsZeile = { bestellpositionId: string; menge: number };

/**
 * Ware gegen eine Bestellung einbuchen.
 *
 * Es gibt keinen Wareneingang ohne Bestellung — das ist die harte Regel
 * des Moduls. Sie klingt bürokratisch und ist das Gegenteil: nur so ist
 * jede Ware im Haus rückführbar und die Liste offener Bestellungen
 * vollständig. Für die spontane Abholung gibt es den Schnellweg, der
 * Bestellung und Eingang in einem Schritt erzeugt.
 */
export async function wareneingangBuchen(
  supabase: Client,
  d: {
    companyId: string;
    userId: string | null;
    bestellungId: string;
    zeilen: EingangsZeile[];
    /** Überlieferung ist möglich, aber nur bewusst. */
    ueberlieferungOk: boolean;
    notiz?: string | null;
  },
): Promise<Ergebnis> {
  if (d.zeilen.length === 0) return { ok: false, grund: "Keine Menge erfasst." };

  const { data: b } = await supabase
    .from("bestellung")
    .select("id, status, ziel, ziel_vorgang_id, nummer")
    .eq("id", d.bestellungId)
    .maybeSingle();

  if (!b) return { ok: false, grund: "Bestellung nicht gefunden." };
  if (b.status === "entwurf") {
    return {
      ok: false,
      grund: "Diese Bestellung ist noch ein Entwurf. Erst abschicken, dann einbuchen.",
    };
  }

  const ids = d.zeilen.map((z) => z.bestellpositionId);
  const { data: posRoh } = await supabase
    .from("bestellposition")
    .select("id, artikel_id, bezeichnung, menge, gelieferte_menge, storniert, vorgang_id")
    .in("id", ids)
    .eq("bestellung_id", d.bestellungId);

  const positionen = new Map(
    ((posRoh ?? []) as unknown as {
      id: string;
      artikel_id: string | null;
      bezeichnung: string;
      menge: string;
      gelieferte_menge: string;
      storniert: boolean;
      vorgang_id: string | null;
    }[]).map((p) => [p.id, p]),
  );

  const zumLager = b.ziel !== "baustelle";
  const ort = zumLager ? await hauptlager(supabase, d.companyId) : null;
  if (zumLager && !ort) {
    return { ok: false, grund: "Es gibt kein Hauptlager. Bitte in den Einstellungen anlegen." };
  }

  const abweichungen: string[] = [];
  const vorgaenge = new Set<string>();

  for (const z of d.zeilen) {
    const p = positionen.get(z.bestellpositionId);
    if (!p) return { ok: false, grund: "Position gehört nicht zu dieser Bestellung." };
    if (p.storniert) continue;
    if (z.menge <= 0) continue;
    if (!p.artikel_id) {
      return {
        ok: false,
        grund: `„${p.bezeichnung}" hat keinen Stammartikel und lässt sich nicht einbuchen.`,
      };
    }

    const offen = Number(p.menge) - Number(p.gelieferte_menge);
    if (z.menge > offen) {
      if (!d.ueberlieferungOk) {
        return {
          ok: false,
          grund: `Von „${p.bezeichnung}" sind nur noch ${offen} offen. Mehr einbuchen geht nur mit ausdrücklicher Bestätigung.`,
        };
      }
      abweichungen.push(`${p.bezeichnung}: ${z.menge} statt ${offen}`);
    }

    /*
     * Ziel Baustelle: die Ware sieht kein Regal. Sie geht direkt auf den
     * Vorgang und kostet sofort — genau das ist bei einer
     * Direktlieferung passiert.
     */
    const vorgangId = zumLager ? null : ((b.ziel_vorgang_id as string) ?? p.vorgang_id);
    if (!zumLager && !vorgangId) {
      return { ok: false, grund: "Der Baustellenlieferung fehlt der Vorgang." };
    }

    const { error } = await supabase.from("lagerbewegung").insert({
      company_id: d.companyId,
      artikel_id: p.artikel_id,
      typ: "wareneingang",
      nach_lagerort_id: ort,
      menge: z.menge,
      vorgang_id: vorgangId,
      bestellung_id: d.bestellungId,
      bestellposition_id: p.id,
      notiz:
        d.notiz ??
        (abweichungen.length > 0 ? "Überlieferung bewusst bestätigt" : null),
      created_by: d.userId,
    });

    if (error) return { ok: false, grund: `Buchung fehlgeschlagen: ${error.message}` };

    const { error: mengeFehler } = await supabase
      .from("bestellposition")
      .update({ gelieferte_menge: Number(p.gelieferte_menge) + z.menge })
      .eq("id", p.id);

    if (mengeFehler) {
      return { ok: false, grund: `Menge fortschreiben fehlgeschlagen: ${mengeFehler.message}` };
    }

    if (p.vorgang_id) vorgaenge.add(p.vorgang_id);
    if (vorgangId) vorgaenge.add(vorgangId);
  }

  await statusNachziehen(supabase, d.bestellungId);
  for (const vorgangId of vorgaenge) {
    await materialGateSchreiben(supabase, { companyId: d.companyId, vorgangId });
  }

  return abweichungen.length > 0
    ? { ok: true, hinweis: `Abweichung protokolliert: ${abweichungen.join(", ")}.` }
    : { ok: true };
}

/**
 * Der Status der Bestellung ergibt sich aus ihren Positionen — nichts
 * geliefert heisst bestellt, alles heisst geliefert, dazwischen
 * teilgeliefert.
 */
export async function statusNachziehen(
  supabase: Client,
  bestellungId: string,
): Promise<void> {
  const { data: pos } = await supabase
    .from("bestellposition")
    .select("menge, gelieferte_menge, storniert")
    .eq("bestellung_id", bestellungId);

  const zeilen = (pos ?? []) as unknown as {
    menge: string;
    gelieferte_menge: string;
    storniert: boolean;
  }[];

  const offen = zeilen.filter(
    (z) => !z.storniert && Number(z.gelieferte_menge) < Number(z.menge),
  );
  const etwasDa = zeilen.some((z) => Number(z.gelieferte_menge) > 0);
  const neu = offen.length === 0 ? "geliefert" : etwasDa ? "teilgeliefert" : "bestellt";

  await supabase
    .from("bestellung")
    .update({ status: neu })
    .eq("id", bestellungId)
    .in("status", ["bestellt", "teilgeliefert"]);
}

/* ----------------------------------------------------------- ENTNAHME */

/**
 * Material auf einen Vorgang buchen — der Haken auf der Beladeliste.
 *
 * Die einzige Bewegung, die Ist-Materialkosten erzeugt. Kein zweiter
 * Buchungsschritt für irgendwen: wer hakt, bucht.
 */
export async function entnahmeBuchen(
  supabase: Client,
  d: {
    companyId: string;
    userId: string | null;
    vorgangId: string;
    artikelId: string;
    menge: number;
    /** Standard ist das Hauptlager; beim Van-Stock das Fahrzeug. */
    vonLagerortId?: string | null;
    einsatzId?: string | null;
    clientUuid?: string | null;
    notiz?: string | null;
  },
): Promise<Ergebnis> {
  if (d.menge <= 0) return { ok: false, grund: "Menge muss größer als null sein." };

  const ort = d.vonLagerortId ?? (await hauptlager(supabase, d.companyId));
  if (!ort) return { ok: false, grund: "Kein Lagerort gefunden." };

  const { error } = await supabase.from("lagerbewegung").insert({
    company_id: d.companyId,
    artikel_id: d.artikelId,
    typ: "entnahme",
    von_lagerort_id: ort,
    menge: d.menge,
    vorgang_id: d.vorgangId,
    einsatz_id: d.einsatzId ?? null,
    client_uuid: d.clientUuid ?? null,
    notiz: d.notiz ?? null,
    created_by: d.userId,
  });

  if (error) {
    /*
     * Dieselbe Buchung zweimal ist kein Fehler, sondern eine Meldung,
     * die aus der Offline-Warteschlange doppelt angekommen ist.
     */
    if (error.code === "23505") return { ok: true, hinweis: "War schon gebucht." };
    return { ok: false, grund: `Buchung fehlgeschlagen: ${error.message}` };
  }

  await materialGateSchreiben(supabase, {
    companyId: d.companyId,
    vorgangId: d.vorgangId,
  });
  return { ok: true };
}

/**
 * Rückläufer: was übrig blieb, geht zurück ins Lager und entlastet den
 * Vorgang. In der Photovoltaik ständig — übrige Optimierer, angebrochene
 * Gebinde.
 */
export async function rueckgabeBuchen(
  supabase: Client,
  d: {
    companyId: string;
    userId: string | null;
    vorgangId: string;
    artikelId: string;
    menge: number;
    nachLagerortId?: string | null;
    clientUuid?: string | null;
  },
): Promise<Ergebnis> {
  if (d.menge <= 0) return { ok: false, grund: "Menge muss größer als null sein." };

  const ort = d.nachLagerortId ?? (await hauptlager(supabase, d.companyId));
  if (!ort) return { ok: false, grund: "Kein Lagerort gefunden." };

  const { error } = await supabase.from("lagerbewegung").insert({
    company_id: d.companyId,
    artikel_id: d.artikelId,
    typ: "rueckgabe_korrektur",
    ist_rueckgabe: true,
    nach_lagerort_id: ort,
    menge: d.menge,
    vorgang_id: d.vorgangId,
    client_uuid: d.clientUuid ?? null,
    created_by: d.userId,
  });

  if (error) {
    if (error.code === "23505") return { ok: true, hinweis: "War schon gebucht." };
    return { ok: false, grund: `Buchung fehlgeschlagen: ${error.message}` };
  }

  await materialGateSchreiben(supabase, {
    companyId: d.companyId,
    vorgangId: d.vorgangId,
  });
  return { ok: true };
}

/**
 * Umbuchung zwischen zwei Lagerorten — Hauptlager auf Bus 1 und zurück.
 * Kostenneutral: kein Vorgang, keine Ist-Kosten.
 */
export async function umbuchen(
  supabase: Client,
  d: {
    companyId: string;
    userId: string | null;
    artikelId: string;
    menge: number;
    vonLagerortId: string;
    nachLagerortId: string;
  },
): Promise<Ergebnis> {
  if (d.menge <= 0) return { ok: false, grund: "Menge muss größer als null sein." };
  if (d.vonLagerortId === d.nachLagerortId) {
    return { ok: false, grund: "Herkunft und Ziel sind derselbe Ort." };
  }

  const { error } = await supabase.from("lagerbewegung").insert({
    company_id: d.companyId,
    artikel_id: d.artikelId,
    typ: "umbuchung",
    von_lagerort_id: d.vonLagerortId,
    nach_lagerort_id: d.nachLagerortId,
    menge: d.menge,
    created_by: d.userId,
  });

  if (error) return { ok: false, grund: `Umbuchung fehlgeschlagen: ${error.message}` };
  return { ok: true };
}

/**
 * Inventur: die gezählte Menge wird zur Wahrheit, die Differenz zur
 * Bewegung. Kein stilles Überschreiben — wer korrigiert, steht im
 * Journal.
 */
export async function inventurBuchen(
  supabase: Client,
  d: {
    companyId: string;
    userId: string | null;
    lagerortId: string;
    artikelId: string;
    /** Was tatsächlich dort liegt. */
    istMenge: number;
    /** Was das Journal sagt. */
    sollMenge: number;
    notiz?: string | null;
  },
): Promise<Ergebnis> {
  const diff = d.istMenge - d.sollMenge;
  if (diff === 0) return { ok: true, hinweis: "Keine Abweichung." };

  const { error } = await supabase.from("lagerbewegung").insert({
    company_id: d.companyId,
    artikel_id: d.artikelId,
    typ: "rueckgabe_korrektur",
    von_lagerort_id: diff < 0 ? d.lagerortId : null,
    nach_lagerort_id: diff > 0 ? d.lagerortId : null,
    menge: Math.abs(diff),
    notiz: d.notiz ?? `Inventur: gezählt ${d.istMenge}, gebucht ${d.sollMenge}`,
    created_by: d.userId,
  });

  if (error) return { ok: false, grund: `Korrektur fehlgeschlagen: ${error.message}` };
  return { ok: true, hinweis: `${diff > 0 ? "+" : ""}${diff} korrigiert.` };
}
