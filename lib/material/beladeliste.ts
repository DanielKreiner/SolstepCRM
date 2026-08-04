import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deckung } from "@/lib/material/deckung";
import { endOfViennaDay, startOfViennaDay } from "@/lib/time";

/**
 * Die Beladeliste.
 *
 * Die zentrale Ansicht des Monteurs am Morgen. Sie muss auf einen Blick
 * drei Fragen beantworten: Was lade ich? Wofür? Was ist schon dort?
 *
 * Der dritte Abschnitt ist der wichtigste und der, den Lagersoftware
 * meist weglässt: was fehlt. Der Monteur soll es VOR der Abfahrt sehen
 * und nicht auf dem Dach.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type LadeZeile = {
  bedarfId: string;
  artikelId: string;
  sku: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  seriennummernpflichtig: boolean;
  bereitgestellt: boolean;
  uebernommen: boolean;
  /** Was schon auf dem Vorgang gebucht ist. */
  gebucht: number;
  /** Nur bei „fehlt noch": wann es kommen soll. */
  liefertermin: string | null;
};

export type VorgangsBlock = {
  vorgangId: string;
  nummer: string;
  kunde: string;
  adresse: string | null;
  von: string;
  bis: string;
  zuLaden: LadeZeile[];
  aufBaustelle: LadeZeile[];
  fehlt: LadeZeile[];
};

export type Nachfuellen = {
  artikelId: string;
  bezeichnung: string;
  einheit: string;
  bestand: number;
  min: number;
  soll: number;
};

export type Lieferung = {
  bestellungId: string;
  nummer: string | null;
  lieferant: string;
  vorgangNummer: string;
  termin: string | null;
  zeilen: { positionId: string; bezeichnung: string; offen: number; einheit: string }[];
};

export type Beladeliste = {
  tag: string;
  fahrzeug: { id: string; name: string; lagerortId: string | null } | null;
  bloecke: VorgangsBlock[];
  nachfuellen: Nachfuellen[];
  /** Direktlieferungen auf die Baustellen dieses Tages. */
  lieferungen: Lieferung[];
};

/**
 * Bestellungen mit Ziel Baustelle, die noch nicht bestätigt sind.
 *
 * Wer davorsteht, weiss als Einziger, was abgeladen wurde — deshalb
 * taucht die Bestätigung dort auf, wo er ohnehin hinschaut.
 */
async function baustellenlieferungen(
  supabase: Client,
  vorgangIds: string[],
): Promise<Lieferung[]> {
  if (vorgangIds.length === 0) return [];

  const { data: roh } = await supabase
    .from("bestellung")
    .select(
      `id, nummer, ziel_vorgang_id,
       lieferant:lieferant_id ( name ),
       vorgang:ziel_vorgang_id ( number ),
       positionen:bestellposition ( id, bezeichnung, menge, gelieferte_menge, storniert, einheit, bestaetigter_termin )`,
    )
    .eq("ziel", "baustelle")
    .in("status", ["bestellt", "teilgeliefert"])
    .in("ziel_vorgang_id", vorgangIds);

  return ((roh ?? []) as unknown as {
    id: string;
    nummer: string | null;
    lieferant: { name: string } | null;
    vorgang: { number: string } | null;
    positionen: {
      id: string;
      bezeichnung: string;
      menge: string;
      gelieferte_menge: string;
      storniert: boolean;
      einheit: string;
      bestaetigter_termin: string | null;
    }[];
  }[])
    .map((b) => {
      const zeilen = b.positionen
        .filter((p) => !p.storniert && Number(p.gelieferte_menge) < Number(p.menge))
        .map((p) => ({
          positionId: p.id,
          bezeichnung: p.bezeichnung,
          offen: Number(p.menge) - Number(p.gelieferte_menge),
          einheit: p.einheit,
        }));
      const termine = b.positionen
        .map((p) => p.bestaetigter_termin)
        .filter((t): t is string => Boolean(t))
        .sort();
      return {
        bestellungId: b.id,
        nummer: b.nummer,
        lieferant: b.lieferant?.name ?? "—",
        vorgangNummer: b.vorgang?.number ?? "—",
        termin: termine[0] ?? null,
        zeilen,
      };
    })
    .filter((l) => l.zeilen.length > 0);
}

/**
 * @param tag ISO-Datum in Ortszeit. Der Monteur schaltet zwischen heute
 *            und morgen um — abends wird fürs nächste Pensum geladen.
 */
export async function beladeliste(
  supabase: Client,
  d: { companyId: string; tag: string; userId?: string | null; fahrzeugId?: string | null },
): Promise<Beladeliste> {
  const von = startOfViennaDay(d.tag).toISOString();
  const bis = endOfViennaDay(d.tag).toISOString();

  let frage = supabase
    .from("einsatz")
    .select(
      `id, vorgang_id, von, bis, fahrzeug_id,
       fahrzeug:fahrzeug_id ( id, name ),
       personen:einsatz_person ( user_id ),
       vorgang:vorgang_id ( number, adresse, plz, ort, customer:customer_id ( name ) )`,
    )
    .eq("art", "auftrag")
    .not("vorgang_id", "is", null)
    .gte("von", von)
    .lte("von", bis)
    .order("von");

  if (d.fahrzeugId) frage = frage.eq("fahrzeug_id", d.fahrzeugId);

  const { data: roh } = await frage;

  let einsaetze = (roh ?? []) as unknown as {
    id: string;
    vorgang_id: string;
    von: string;
    bis: string;
    fahrzeug_id: string | null;
    fahrzeug: { id: string; name: string } | null;
    personen: { user_id: string }[];
    vorgang: {
      number: string;
      adresse: string | null;
      plz: string | null;
      ort: string | null;
      customer: { name: string } | null;
    } | null;
  }[];

  /*
   * Der Monteur sieht seine eigenen Einsätze. Gefiltert wird hier und
   * nicht in der Abfrage: die Zuordnung steckt in einer Untertabelle,
   * und ein Join darauf würde Einsätze mit zwei Personen doppeln.
   */
  if (d.userId) {
    einsaetze = einsaetze.filter((e) =>
      e.personen.some((p) => p.user_id === d.userId),
    );
  }

  const fahrzeugRoh = einsaetze.find((e) => e.fahrzeug)?.fahrzeug ?? null;
  let fahrzeug: Beladeliste["fahrzeug"] = null;
  if (fahrzeugRoh) {
    const { data: ort } = await supabase
      .from("lagerort")
      .select("id")
      .eq("fahrzeug_id", fahrzeugRoh.id)
      .maybeSingle();
    fahrzeug = {
      id: fahrzeugRoh.id,
      name: fahrzeugRoh.name,
      lagerortId: (ort?.id as string | null) ?? null,
    };
  }

  const vorgangIds = [...new Set(einsaetze.map((e) => e.vorgang_id))];
  if (vorgangIds.length === 0) {
    return {
      tag: d.tag,
      fahrzeug,
      bloecke: [],
      nachfuellen: await nachfuellliste(supabase, fahrzeug?.lagerortId ?? null),
      lieferungen: [],
    };
  }

  const { data: bedarfRoh } = await supabase
    .from("vorgang_bedarf")
    .select(
      `id, vorgang_id, artikel_id, bezeichnung, menge, einheit, bereitgestellt_am,
       uebernommen_am, artikel:artikel_id ( sku, typ, seriennummernpflichtig )`,
    )
    .in("vorgang_id", vorgangIds)
    .order("sort");

  const bedarf = ((bedarfRoh ?? []) as unknown as {
    id: string;
    vorgang_id: string;
    artikel_id: string | null;
    bezeichnung: string;
    menge: string;
    einheit: string;
    bereitgestellt_am: string | null;
    uebernommen_am: string | null;
    artikel: { sku: string; typ: string; seriennummernpflichtig: boolean } | null;
  }[])
    /*
     * Nur Stücklisten-Material steht auf der Beladeliste. Van-Stock
     * liegt schon im Bus, Kleinmaterial wird nie gebucht — beides hier
     * anzuzeigen wäre Lärm.
     */
    .filter((b) => b.artikel_id && b.artikel?.typ === "stueckliste");

  const artikelIds = [...new Set(bedarf.map((b) => b.artikel_id as string))];

  const [bewegungen, bestand, bestellt] = await Promise.all([
    supabase
      .from("lagerbewegung")
      .select("artikel_id, vorgang_id, menge, ist_rueckgabe")
      .in("vorgang_id", vorgangIds),
    artikelIds.length > 0
      ? supabase
          .from("v_bestand")
          .select("artikel_id, menge")
          .eq("lagerort_art", "hauptlager")
          .in("artikel_id", artikelIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("bestellposition")
      .select(
        "artikel_id, vorgang_id, menge, gelieferte_menge, storniert, bestaetigter_termin, bestellung:bestellung_id ( status )",
      )
      .in("vorgang_id", vorgangIds),
  ]);

  const gebucht = new Map<string, number>();
  for (const b of (bewegungen.data ?? []) as unknown as {
    artikel_id: string;
    vorgang_id: string;
    menge: string;
    ist_rueckgabe: boolean;
  }[]) {
    const k = `${b.vorgang_id}|${b.artikel_id}`;
    gebucht.set(k, (gebucht.get(k) ?? 0) + (b.ist_rueckgabe ? -1 : 1) * Number(b.menge));
  }

  const imLager = new Map<string, number>();
  for (const b of (bestand.data ?? []) as unknown as {
    artikel_id: string;
    menge: string;
  }[]) {
    imLager.set(b.artikel_id, Number(b.menge));
  }

  const bestellInfo = new Map<string, { menge: number; termin: string | null }>();
  for (const p of (bestellt.data ?? []) as unknown as {
    artikel_id: string | null;
    vorgang_id: string | null;
    menge: string;
    gelieferte_menge: string;
    storniert: boolean;
    bestaetigter_termin: string | null;
    bestellung: { status: string } | null;
  }[]) {
    if (p.storniert || !p.artikel_id || !p.vorgang_id) continue;
    const st = p.bestellung?.status;
    if (st !== "bestellt" && st !== "teilgeliefert") continue;
    const rest = Number(p.menge) - Number(p.gelieferte_menge);
    if (rest <= 0) continue;
    const k = `${p.vorgang_id}|${p.artikel_id}`;
    const da = bestellInfo.get(k) ?? { menge: 0, termin: null };
    da.menge += rest;
    if (p.bestaetigter_termin && (!da.termin || p.bestaetigter_termin > da.termin)) {
      da.termin = p.bestaetigter_termin;
    }
    bestellInfo.set(k, da);
  }

  /* Der Lagerbestand wird nur einmal vergeben — wer früher dran ist, zuerst. */
  const rest = new Map(imLager);
  const bloecke: VorgangsBlock[] = [];

  for (const e of einsaetze) {
    if (bloecke.some((b) => b.vorgangId === e.vorgang_id)) continue;

    const zeilen = bedarf.filter((b) => b.vorgang_id === e.vorgang_id);
    const zuLaden: LadeZeile[] = [];
    const aufBaustelle: LadeZeile[] = [];
    const fehlt: LadeZeile[] = [];

    for (const b of zeilen) {
      const artikelId = b.artikel_id as string;
      const k = `${e.vorgang_id}|${artikelId}`;
      const schonDa = gebucht.get(k) ?? 0;
      const verfuegbar = rest.get(artikelId) ?? 0;
      const order = bestellInfo.get(k);

      const status = deckung({
        menge: Number(b.menge),
        aufVorgang: schonDa,
        imLager: verfuegbar,
        bestellt: order?.menge ?? 0,
        terminReicht: Boolean(order?.termin),
      });

      const zeile: LadeZeile = {
        bedarfId: b.id,
        artikelId,
        sku: b.artikel?.sku ?? null,
        bezeichnung: b.bezeichnung,
        menge: Number(b.menge) - schonDa,
        einheit: b.einheit,
        seriennummernpflichtig: Boolean(b.artikel?.seriennummernpflichtig),
        bereitgestellt: Boolean(b.bereitgestellt_am),
        uebernommen: Boolean(b.uebernommen_am),
        gebucht: schonDa,
        liefertermin: order?.termin ?? null,
      };

      /*
       * Vorkommissioniert und noch nicht übernommen: die Ware ist zwar
       * gebucht, liegt aber im Hof und nicht im Bus. Sie bleibt unter
       * „Zu laden" stehen, bis jemand die Übernahme bestätigt — sonst
       * fährt das Team ohne die Palette los, die für sie bereitsteht.
       */
      if (zeile.bereitgestellt && !zeile.uebernommen) {
        zuLaden.push({ ...zeile, menge: schonDa > 0 ? schonDa : zeile.menge });
      } else if (status === "geladen") {
        /*
         * Schon auf der Baustelle: entweder an einem Vortag geladen oder
         * direkt dorthin geliefert. Nicht abhakbar — sonst lädt jemand
         * bei einer mehrtägigen Montage alles ein zweites Mal.
         */
        aufBaustelle.push({ ...zeile, menge: schonDa });
      } else if (status === "im_lager") {
        rest.set(artikelId, verfuegbar - zeile.menge);
        zuLaden.push(zeile);
        if (schonDa > 0) aufBaustelle.push({ ...zeile, menge: schonDa });
      } else {
        fehlt.push(zeile);
        if (schonDa > 0) aufBaustelle.push({ ...zeile, menge: schonDa });
      }
    }

    bloecke.push({
      vorgangId: e.vorgang_id,
      nummer: e.vorgang?.number ?? "—",
      kunde: e.vorgang?.customer?.name ?? "—",
      adresse: [e.vorgang?.adresse, e.vorgang?.plz, e.vorgang?.ort]
        .filter(Boolean)
        .join(", ") || null,
      von: e.von,
      bis: e.bis,
      zuLaden,
      aufBaustelle,
      fehlt,
    });
  }

  return {
    tag: d.tag,
    fahrzeug,
    bloecke,
    nachfuellen: await nachfuellliste(supabase, fahrzeug?.lagerortId ?? null),
    lieferungen: await baustellenlieferungen(supabase, vorgangIds),
  };
}

/**
 * Was auf dem Fahrzeug unter das Minimum gefallen ist.
 *
 * Das ist der halbe Sinn des Van-Stocks: nicht der Bestand interessiert,
 * sondern der Moment, in dem er nicht mehr reicht.
 */
export async function nachfuellliste(
  supabase: Client,
  lagerortId: string | null,
): Promise<Nachfuellen[]> {
  if (!lagerortId) return [];

  const { data: regeln } = await supabase
    .from("vanstock_regel")
    .select("artikel_id, min_menge, max_menge, artikel:artikel_id ( name, unit )")
    .eq("lagerort_id", lagerortId);

  const liste = (regeln ?? []) as unknown as {
    artikel_id: string;
    min_menge: string;
    max_menge: string | null;
    artikel: { name: string; unit: string } | null;
  }[];
  if (liste.length === 0) return [];

  const { data: bestand } = await supabase
    .from("v_bestand")
    .select("artikel_id, menge")
    .eq("lagerort_id", lagerortId);

  const da = new Map(
    ((bestand ?? []) as unknown as { artikel_id: string; menge: string }[]).map((b) => [
      b.artikel_id,
      Number(b.menge),
    ]),
  );

  return liste
    .map((r) => {
      const ist = da.get(r.artikel_id) ?? 0;
      return {
        artikelId: r.artikel_id,
        bezeichnung: r.artikel?.name ?? "Artikel",
        einheit: r.artikel?.unit ?? "Stk",
        bestand: ist,
        min: Number(r.min_menge),
        soll: r.max_menge === null ? Number(r.min_menge) : Number(r.max_menge),
      };
    })
    .filter((r) => r.bestand < r.min);
}
