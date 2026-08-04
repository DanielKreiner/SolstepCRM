import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deckung, materialGate, type DeckungStatus } from "@/lib/material/deckung";

/**
 * Die Bedarfsliste eines Vorgangs mit ihrem Deckungsstatus.
 *
 * Der Status wird gerechnet, nicht gespeichert: er hängt an Bewegungen,
 * Bestellungen und dem Montagetermin, und alle drei ändern sich, ohne
 * dass jemand die Bedarfsliste anfasst. Ein gespeicherter Status wäre
 * spätestens am nächsten Morgen falsch.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type BedarfAnsicht = {
  id: string;
  artikelId: string | null;
  sku: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  herkunft: string;
  notiz: string | null;
  bereitgestellt: boolean;
  uebernommen: boolean;
  status: DeckungStatus;
  /** Was schon auf dem Vorgang gebucht ist. */
  aufVorgang: number;
  imLager: number;
  bestellt: number;
  /** Nummern der Bestellungen, in denen die Position steckt. */
  bestellungen: string[];
  /** Der bestätigte Liefertermin, wenn es einen gibt. */
  liefertermin: string | null;
};

export type BedarfsListe = {
  zeilen: BedarfAnsicht[];
  streng: boolean;
  montageAb: string | null;
  gate: "erledigt" | "laeuft" | "offen" | null;
};

export async function bedarfsListe(
  supabase: Client,
  d: { companyId: string; vorgangId: string },
): Promise<BedarfsListe> {
  const [{ data: roh }, { data: firma }, { data: einsatz }] = await Promise.all([
    supabase
      .from("vorgang_bedarf")
      .select(
        "id, artikel_id, bezeichnung, menge, einheit, herkunft, notiz, bereitgestellt_am, uebernommen_am, artikel:artikel_id ( sku )",
      )
      .eq("vorgang_id", d.vorgangId)
      .order("sort"),
    supabase
      .from("company")
      .select("deckung_streng")
      .eq("id", d.companyId)
      .maybeSingle(),
    supabase
      .from("einsatz")
      .select("von")
      .eq("vorgang_id", d.vorgangId)
      .eq("art", "auftrag")
      .order("von")
      .limit(1)
      .maybeSingle(),
  ]);

  const zeilenRoh = (roh ?? []) as unknown as {
    id: string;
    artikel_id: string | null;
    bezeichnung: string;
    menge: string;
    einheit: string;
    herkunft: string;
    notiz: string | null;
    bereitgestellt_am: string | null;
    uebernommen_am: string | null;
    artikel: { sku: string } | null;
  }[];

  const streng = Boolean(firma?.deckung_streng);
  const montageAb = (einsatz?.von as string | null) ?? null;

  if (zeilenRoh.length === 0) {
    return { zeilen: [], streng, montageAb, gate: null };
  }

  const artikelIds = zeilenRoh
    .map((z) => z.artikel_id)
    .filter((a): a is string => Boolean(a));

  /*
   * Drei Zahlen je Artikel: was auf dem Vorgang liegt, was im Lager
   * liegt, was unterwegs ist. Alle drei in einem Zug statt je Zeile —
   * bei dreissig Positionen wären das sonst neunzig Abfragen.
   */
  const [bewegungen, bestand, bestellt] = await Promise.all([
    artikelIds.length > 0
      ? supabase
          .from("lagerbewegung")
          .select("artikel_id, menge, typ, ist_rueckgabe")
          .eq("vorgang_id", d.vorgangId)
          .in("artikel_id", artikelIds)
      : Promise.resolve({ data: [] }),
    artikelIds.length > 0
      ? supabase
          .from("v_bestand")
          .select("artikel_id, menge, lagerort_art")
          .eq("lagerort_art", "hauptlager")
          .in("artikel_id", artikelIds)
      : Promise.resolve({ data: [] }),
    artikelIds.length > 0
      ? supabase
          .from("bestellposition")
          .select(
            "artikel_id, menge, gelieferte_menge, storniert, bestaetigter_termin, bestellung:bestellung_id ( nummer, status )",
          )
          .eq("vorgang_id", d.vorgangId)
          .in("artikel_id", artikelIds)
      : Promise.resolve({ data: [] }),
  ]);

  const aufVorgang = new Map<string, number>();
  for (const b of (bewegungen.data ?? []) as unknown as {
    artikel_id: string;
    menge: string;
    typ: string;
    ist_rueckgabe: boolean;
  }[]) {
    const vorzeichen = b.ist_rueckgabe ? -1 : 1;
    aufVorgang.set(
      b.artikel_id,
      (aufVorgang.get(b.artikel_id) ?? 0) + vorzeichen * Number(b.menge),
    );
  }

  const imLager = new Map<string, number>();
  for (const b of (bestand.data ?? []) as unknown as {
    artikel_id: string;
    menge: string;
  }[]) {
    imLager.set(b.artikel_id, (imLager.get(b.artikel_id) ?? 0) + Number(b.menge));
  }

  const offeneBestellung = new Map<
    string,
    { menge: number; nummern: Set<string>; termin: string | null }
  >();
  for (const p of (bestellt.data ?? []) as unknown as {
    artikel_id: string;
    menge: string;
    gelieferte_menge: string;
    storniert: boolean;
    bestaetigter_termin: string | null;
    bestellung: { nummer: string | null; status: string } | null;
  }[]) {
    /*
     * Entwürfe zählen nicht. Wer glaubt, eine Bestellung sei draussen,
     * weil sie im System steht, steht am Montagetag ohne Ware da.
     */
    const status = p.bestellung?.status;
    if (p.storniert) continue;
    if (status !== "bestellt" && status !== "teilgeliefert") continue;

    const rest = Number(p.menge) - Number(p.gelieferte_menge);
    if (rest <= 0) continue;

    const da = offeneBestellung.get(p.artikel_id) ?? {
      menge: 0,
      nummern: new Set<string>(),
      termin: null,
    };
    da.menge += rest;
    if (p.bestellung?.nummer) da.nummern.add(p.bestellung.nummer);
    /* Der späteste bestätigte Termin entscheidet — der bremst. */
    if (p.bestaetigter_termin && (!da.termin || p.bestaetigter_termin > da.termin)) {
      da.termin = p.bestaetigter_termin;
    }
    offeneBestellung.set(p.artikel_id, da);
  }

  const zeilen: BedarfAnsicht[] = zeilenRoh.map((z) => {
    const a = z.artikel_id;
    const gebucht = a ? (aufVorgang.get(a) ?? 0) : 0;
    const lager = a ? (imLager.get(a) ?? 0) : 0;
    const order = a ? offeneBestellung.get(a) : undefined;
    const termin = order?.termin ?? null;

    /*
     * Ohne Montagetermin kann kein Liefertermin zu spät sein — dann
     * zählt die bestätigte Bestellung.
     */
    const terminReicht = Boolean(
      termin && (!montageAb || termin <= montageAb.slice(0, 10)),
    );

    const status = deckung({
      menge: Number(z.menge),
      aufVorgang: gebucht,
      imLager: lager,
      bestellt: order?.menge ?? 0,
      terminReicht,
    });

    return {
      id: z.id,
      artikelId: a,
      sku: z.artikel?.sku ?? null,
      bezeichnung: z.bezeichnung,
      menge: Number(z.menge),
      einheit: z.einheit,
      herkunft: z.herkunft,
      notiz: z.notiz,
      bereitgestellt: Boolean(z.bereitgestellt_am),
      uebernommen: Boolean(z.uebernommen_am),
      status,
      aufVorgang: gebucht,
      imLager: lager,
      bestellt: order?.menge ?? 0,
      bestellungen: order ? [...order.nummern] : [],
      liefertermin: termin,
    };
  });

  return {
    zeilen,
    streng,
    montageAb,
    gate: materialGate(
      zeilen.map((z) => z.status),
      streng,
    ),
  };
}

export type OffeneZeile = {
  id: string;
  vorgangId: string;
  vorgangNummer: string;
  kunde: string;
  ort: string | null;
  montageAb: string | null;
  artikelId: string | null;
  sku: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  status: DeckungStatus;
  /** Nummern offener Bestellungen, in denen die Zeile schon steckt. */
  bereitsBestellt: string[];
  /**
   * Steckt die Zeile in einem Entwurf? Der zählt nicht als bestellt —
   * aber wer sie ein zweites Mal auf eine Bestellung setzt, soll es
   * wissen.
   */
  inEntwurf: boolean;
};

/**
 * Alles, was noch nicht gedeckt ist — über alle laufenden Vorgänge.
 *
 * Die Grundlage der Sammelbestellung: der Grosshändler liefert ab einer
 * Mindestmenge frachtfrei, und wer für jeden Vorgang einzeln bestellt,
 * zahlt dreimal Fracht für dieselbe Palette.
 */
export async function offenerBedarf(supabase: Client): Promise<OffeneZeile[]> {
  /* Der Mandant kommt aus der RLS des übergebenen Clients. */
  const { data: roh } = await supabase
    .from("vorgang_bedarf")
    .select(
      `id, vorgang_id, artikel_id, bezeichnung, menge, einheit,
       artikel:artikel_id ( sku ),
       vorgang:vorgang_id ( number, phase, ort, customer:customer_id ( name ) )`,
    )
    .order("sort");

  const zeilen = (roh ?? []) as unknown as {
    id: string;
    vorgang_id: string;
    artikel_id: string | null;
    bezeichnung: string;
    menge: string;
    einheit: string;
    artikel: { sku: string } | null;
    vorgang: {
      number: string;
      phase: string;
      ort: string | null;
      customer: { name: string } | null;
    } | null;
  }[];

  /* Abgeschlossene und verlorene Vorgänge brauchen nichts mehr. */
  const laufend = zeilen.filter((z) =>
    ["beauftragt", "montage"].includes(z.vorgang?.phase ?? ""),
  );
  if (laufend.length === 0) return [];

  const vorgangIds = [...new Set(laufend.map((z) => z.vorgang_id))];
  const artikelIds = [
    ...new Set(laufend.map((z) => z.artikel_id).filter((a): a is string => Boolean(a))),
  ];

  const [bewegungen, bestand, bestellt, einsaetze] = await Promise.all([
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
        "artikel_id, vorgang_id, menge, gelieferte_menge, storniert, bestaetigter_termin, bestellung:bestellung_id ( nummer, status )",
      )
      .in("vorgang_id", vorgangIds),
    supabase
      .from("einsatz")
      .select("vorgang_id, von")
      .eq("art", "auftrag")
      .in("vorgang_id", vorgangIds)
      .order("von"),
  ]);

  const aufVorgang = new Map<string, number>();
  for (const b of (bewegungen.data ?? []) as unknown as {
    artikel_id: string;
    vorgang_id: string;
    menge: string;
    ist_rueckgabe: boolean;
  }[]) {
    const k = `${b.vorgang_id}|${b.artikel_id}`;
    aufVorgang.set(k, (aufVorgang.get(k) ?? 0) + (b.ist_rueckgabe ? -1 : 1) * Number(b.menge));
  }

  const imLager = new Map<string, number>();
  for (const b of (bestand.data ?? []) as unknown as {
    artikel_id: string;
    menge: string;
  }[]) {
    imLager.set(b.artikel_id, Number(b.menge));
  }

  const offeneBestellung = new Map<
    string,
    { menge: number; nummern: Set<string>; termin: string | null }
  >();
  const inEntwurf = new Set<string>();
  for (const p of (bestellt.data ?? []) as unknown as {
    artikel_id: string | null;
    vorgang_id: string | null;
    menge: string;
    gelieferte_menge: string;
    storniert: boolean;
    bestaetigter_termin: string | null;
    bestellung: { nummer: string | null; status: string } | null;
  }[]) {
    if (p.storniert || !p.artikel_id || !p.vorgang_id) continue;
    const status = p.bestellung?.status;
    if (status === "entwurf") {
      inEntwurf.add(`${p.vorgang_id}|${p.artikel_id}`);
      continue;
    }
    if (status !== "bestellt" && status !== "teilgeliefert") continue;

    const rest = Number(p.menge) - Number(p.gelieferte_menge);
    if (rest <= 0) continue;

    const k = `${p.vorgang_id}|${p.artikel_id}`;
    const da = offeneBestellung.get(k) ?? {
      menge: 0,
      nummern: new Set<string>(),
      termin: null,
    };
    da.menge += rest;
    if (p.bestellung?.nummer) da.nummern.add(p.bestellung.nummer);
    if (p.bestaetigter_termin && (!da.termin || p.bestaetigter_termin > da.termin)) {
      da.termin = p.bestaetigter_termin;
    }
    offeneBestellung.set(k, da);
  }

  const montage = new Map<string, string>();
  for (const e of (einsaetze.data ?? []) as unknown as {
    vorgang_id: string;
    von: string;
  }[]) {
    if (!montage.has(e.vorgang_id)) montage.set(e.vorgang_id, e.von);
  }

  /*
   * Der Lagerbestand wird über die Vorgänge hinweg nur einmal vergeben:
   * zwanzig Dachhaken im Regal decken einen Vorgang, nicht drei. Wer
   * zuerst dran ist, entscheidet der Montagetermin.
   */
  const sortiert = [...laufend].sort((a, b) => {
    const ma = montage.get(a.vorgang_id) ?? "9999";
    const mb = montage.get(b.vorgang_id) ?? "9999";
    return ma < mb ? -1 : ma > mb ? 1 : 0;
  });

  const rest = new Map(imLager);
  const ergebnis: OffeneZeile[] = [];

  for (const z of sortiert) {
    const k = `${z.vorgang_id}|${z.artikel_id}`;
    const gebucht = aufVorgang.get(k) ?? 0;
    const order = offeneBestellung.get(k);
    const montageAb = montage.get(z.vorgang_id) ?? null;
    const termin = order?.termin ?? null;
    const terminReicht = Boolean(
      termin && (!montageAb || termin <= montageAb.slice(0, 10)),
    );

    const verfuegbar = z.artikel_id ? (rest.get(z.artikel_id) ?? 0) : 0;
    const status = deckung({
      menge: Number(z.menge),
      aufVorgang: gebucht,
      imLager: verfuegbar,
      bestellt: order?.menge ?? 0,
      terminReicht,
    });

    if (status === "im_lager" && z.artikel_id) {
      rest.set(z.artikel_id, verfuegbar - (Number(z.menge) - gebucht));
    }

    if (status !== "offen") continue;

    ergebnis.push({
      id: z.id,
      vorgangId: z.vorgang_id,
      vorgangNummer: z.vorgang?.number ?? "—",
      kunde: z.vorgang?.customer?.name ?? "—",
      ort: z.vorgang?.ort ?? null,
      montageAb,
      artikelId: z.artikel_id,
      sku: z.artikel?.sku ?? null,
      bezeichnung: z.bezeichnung,
      menge: Number(z.menge) - gebucht,
      einheit: z.einheit,
      status,
      bereitsBestellt: order ? [...order.nummern] : [],
      inEntwurf: inEntwurf.has(k),
    });
  }

  return ergebnis;
}

export type SerienStand = {
  erfasst: { id: string; nummer: string; artikel: string; am: string }[];
  /** Geräte, die gebucht sind, aber noch keine Nummer haben. */
  offen: { artikelId: string; bezeichnung: string; fehlen: number }[];
};

/**
 * Seriennummern eines Vorgangs.
 *
 * Sie hängen am Vorgang und nicht an der Bewegung: gebraucht werden sie
 * für Garantie, Netzbetreibermeldung und Übergabeprotokoll — dort fragt
 * niemand, aus welchem Regal das Gerät kam.
 *
 * Der Nachtrag blockiert nichts. Wer auf dem Dach steht, soll laden
 * dürfen; der offene Posten bleibt sichtbar, bis jemand ihn schliesst.
 */
export async function seriennummern(
  supabase: Client,
  vorgangId: string,
): Promise<SerienStand> {
  const [{ data: erfasstRoh }, { data: bewegungen }] = await Promise.all([
    supabase
      .from("seriennummer")
      .select("id, nummer, created_at, artikel:artikel_id ( name )")
      .eq("vorgang_id", vorgangId)
      .order("created_at"),
    supabase
      .from("lagerbewegung")
      .select(
        "artikel_id, menge, ist_rueckgabe, artikel:artikel_id ( name, seriennummernpflichtig )",
      )
      .eq("vorgang_id", vorgangId),
  ]);

  const erfasst = ((erfasstRoh ?? []) as unknown as {
    id: string;
    nummer: string;
    created_at: string;
    artikel: { name: string } | null;
  }[]).map((s) => ({
    id: s.id,
    nummer: s.nummer,
    artikel: s.artikel?.name ?? "Artikel",
    am: s.created_at,
  }));

  const gebucht = new Map<string, { name: string; menge: number }>();
  for (const b of (bewegungen ?? []) as unknown as {
    artikel_id: string;
    menge: string;
    ist_rueckgabe: boolean;
    artikel: { name: string; seriennummernpflichtig: boolean } | null;
  }[]) {
    if (!b.artikel?.seriennummernpflichtig) continue;
    const da = gebucht.get(b.artikel_id) ?? { name: b.artikel.name, menge: 0 };
    da.menge += (b.ist_rueckgabe ? -1 : 1) * Number(b.menge);
    gebucht.set(b.artikel_id, da);
  }

  const jeArtikel = new Map<string, number>();
  for (const s of erfasst) {
    jeArtikel.set(s.artikel, (jeArtikel.get(s.artikel) ?? 0) + 1);
  }

  const offen = [...gebucht.entries()]
    .map(([artikelId, g]) => ({
      artikelId,
      bezeichnung: g.name,
      fehlen: Math.floor(g.menge) - (jeArtikel.get(g.name) ?? 0),
    }))
    .filter((o) => o.fehlen > 0);

  return { erfasst, offen };
}

/**
 * Schreibt das berechnete Ergebnis ins Gate.
 *
 * Das Gate „Material" wird nicht mehr abgehakt, sondern gerechnet — ein
 * Häkchen liesse sich setzen, ohne dass ein einziger Dachhaken bestellt
 * wäre. Ohne Bedarfsliste bleibt es unangetastet; dort entscheidet der
 * Mensch.
 */
export async function materialGateSchreiben(
  supabase: Client,
  d: { companyId: string; vorgangId: string },
): Promise<void> {
  const liste = await bedarfsListe(supabase, d);
  if (liste.gate === null) return;

  const { data: gate } = await supabase
    .from("vorgang_gate")
    .select("id, status")
    .eq("vorgang_id", d.vorgangId)
    .eq("key", "material")
    .maybeSingle();

  if (!gate) return;
  /* Ein bewusstes „nicht nötig" bleibt stehen. */
  if (gate.status === "nicht_noetig") return;
  if (gate.status === liste.gate) return;

  await supabase
    .from("vorgang_gate")
    .update({
      status: liste.gate,
      erledigt_am: liste.gate === "erledigt" ? new Date().toISOString() : null,
    })
    .eq("id", gate.id);
}
