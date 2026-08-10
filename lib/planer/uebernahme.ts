/*
 * Artikel aus dem Lager als Planer-Stammdaten übernehmen
 * (Briefing 5.1 und 8.2: Verweis auf den Artikelstamm).
 *
 * Die Artikel tragen ihre technischen Daten als `tech_specs` — eine
 * Liste aus Gruppe, Schlüssel, Wert, Einheit. Geschrieben wurden sie
 * für den Webshop: dort interessiert, was ein Käufer wissen will. Für
 * eine Auslegung braucht es teils andere Werte, und die fehlen
 * entsprechend oft.
 *
 * Deshalb der Grundsatz dieser Datei: übernehmen, was BELEGT dasteht,
 * und für alles andere ehrlich melden, dass es fehlt. Kein Schätzwert,
 * kein Standardwert — eine geratene DC-Grenze führt zu einem String,
 * der im Winter den Wechselrichter überspannt.
 */

export interface SpecEintrag {
  group?: string;
  key?: string;
  value?: string;
  unit?: string;
}

/*
 * ── Zahlen aus deutschen Datenblättern ─────────────────────────────
 */

/**
 * Eine Zahl in deutscher Schreibweise lesen.
 *
 *   „1.100"   → 1100   (Punkt trennt Tausender)
 *   „0,22"    → 0.22   (Komma trennt Nachkommastellen)
 *   „−0,22"   → -0.22  (echtes Minuszeichen U+2212, nicht der Bindestrich)
 *   „+0,05"   → 0.05
 *
 * Die Verwechslung von Punkt und Komma ist hier keine Kosmetik: aus
 * 1.100 V würde sonst 1,1 V.
 */
export function deutscheZahl(roh: string | null | undefined): number | null {
  if (roh == null) return null;
  const text = String(roh)
    // Verschiedene Minus- und Leerzeichen, die in Datenblättern vorkommen.
    .replace(/[−‒–—]/g, "-")
    .replace(/[   ]/g, " ")
    .trim();

  /*
   * Erst die ganze Zahl greifen — Ziffern samt Punkten und Kommas —,
   * dann entscheiden, was die Trennzeichen bedeuten. Andersherum
   * (Muster je Schreibweise) gewann bei „1762" das Tausendermuster und
   * las daraus 176.
   */
  const treffer = text.match(/[+-]?\d[\d.,]*/);
  if (!treffer) return null;
  let zahl = treffer[0].replace(/[.,]+$/, "");

  if (zahl.includes(",")) {
    // Komma ist das Dezimalzeichen; Punkte sind dann Tausendertrenner.
    zahl = zahl.replace(/\./g, "").replace(",", ".");
  } else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(zahl)) {
    // Nur Punkte, und zwar in sauberen Dreiergruppen: Tausendertrenner.
    // „1.100" ist tausendeinhundert, nicht eins Komma eins.
    zahl = zahl.replace(/\./g, "");
  }

  const wert = Number(zahl);
  return Number.isFinite(wert) ? wert : null;
}

/**
 * Ein Bereich wie „140 – 980" oder „80–800".
 * Gedankenstrich, Bindestrich und „bis" kommen alle vor.
 */
export function bereich(roh: string | null | undefined): { von: number; bis: number } | null {
  if (roh == null) return null;
  const text = String(roh).replace(/−/g, "-");
  const teile = text.split(/\s*(?:–|—|-{1,2}|bis)\s*/i).filter((t) => /\d/.test(t));
  if (teile.length < 2) return null;
  const von = deutscheZahl(teile[0]);
  const bis = deutscheZahl(teile[1]);
  if (von == null || bis == null || von >= bis) return null;
  return { von, bis };
}

/** Abmessungen wie „1762 × 1134 × 30 mm" — in Metern zurück. */
export function abmessungenMeter(roh: string | null | undefined): { laenge: number; breite: number } | null {
  if (roh == null) return null;
  const zahlen = String(roh)
    .split(/\s*[×x*]\s*/)
    .map((t) => deutscheZahl(t))
    .filter((z): z is number => z != null);
  if (zahlen.length < 2) return null;
  const [a, b] = zahlen as [number, number];
  // Datenblätter geben Millimeter; alles über 100 ist sicher mm.
  const teiler = a > 100 ? 1000 : 1;
  return { laenge: a / teiler, breite: b / teiler };
}

export function specWert(specs: SpecEintrag[], ...schluessel: string[]): string | null {
  return specEintrag(specs, ...schluessel)?.value ?? null;
}

/** Wie specWert, aber mit der Einheit — die entscheidet mit. */
export function specEintrag(specs: SpecEintrag[], ...schluessel: string[]): SpecEintrag | null {
  for (const s of schluessel) {
    const treffer = specs.find((e) => (e.key ?? "").toLowerCase() === s.toLowerCase());
    if (treffer?.value) return treffer;
  }
  return null;
}

/**
 * Eine Leistungsangabe in kW lesen — die Einheit entscheidet.
 *
 * Im Bestand steht die AC-Leistung der Huawei-Geräte in Watt
 * („3.000 W"), die der Sigenergy-Geräte in Kilowatt („2,5 kW"). Wer die
 * Einheit übergeht, legt einen 3-kW-Wechselrichter als 3.000-kW-Gerät
 * an: die Prüfung des DC/AC-Verhältnisses winkt dann jede noch so grobe
 * Überdimensionierung durch, ohne dass jemand etwas merkt. Genau das ist
 * beim ersten echten Lauf passiert.
 *
 * Ohne Einheit greift eine Notbremse: über 1.000 kW gibt es im Bau, für
 * den dieser Planer gedacht ist, kein Gerät — dann sind es Watt.
 */
export function leistungInKW(eintrag: SpecEintrag | null): number | null {
  if (!eintrag) return null;
  const zahl = deutscheZahl(eintrag.value);
  if (zahl == null) return null;
  const einheit = (eintrag.unit ?? "").trim().toLowerCase();
  if (einheit === "w" || einheit === "va") return zahl / 1000;
  if (einheit === "kw" || einheit === "kva") return zahl;
  return zahl > 1000 ? zahl / 1000 : zahl;
}

/**
 * Eine Kapazitätsangabe in kWh lesen — gleiche Falle wie bei der
 * Leistung, nur mit Wh statt W.
 */
export function kapazitaetInKWh(eintrag: SpecEintrag | null): number | null {
  if (!eintrag) return null;
  const zahl = deutscheZahl(eintrag.value);
  if (zahl == null) return null;
  const einheit = (eintrag.unit ?? "").trim().toLowerCase();
  if (einheit === "wh") return zahl / 1000;
  if (einheit === "kwh") return zahl;
  return zahl > 1000 ? zahl / 1000 : zahl;
}

/*
 * ── Übernahme je Geräteart ─────────────────────────────────────────
 */

export interface Artikel {
  id: string;
  sku: string;
  name: string;
  manufacturer: string | null;
  category: string | null;
  datasheet_url: string | null;
  modul_wp: number | null;
  wr_kw: number | null;
  tech_specs: SpecEintrag[] | null;
}

export interface ModulUebernahme {
  artikel_id: string;
  hersteller: string;
  bezeichnung: string;
  wp: number;
  uoc: number;
  umpp: number;
  isc: number;
  impp: number;
  tk_uoc: number;
  breite: number;
  hoehe: number;
  gewicht: number | null;
  datenblatt_url: string | null;
}

/** Was zu einem vollständigen Datensatz fehlt — im Klartext. */
export interface Luecke {
  sku: string;
  name: string;
  fehlt: string[];
}

export type Ergebnis<T> = { fertig: T[]; luecken: Luecke[]; uebersprungen: number };

/**
 * Ist der Artikel überhaupt ein Gerät dieser Art?
 *
 * Im Lager stehen unter „Wechselrichter" auch Kabelsätze, Bodenwannen
 * und Überspannungsschutz — sie tragen dieselbe Kategorie, weil sie beim
 * Einkauf dazugehören. Als „hier fehlen Datenblattwerte" gemeldet
 * ertränken sie die Liste, die eigentlich zeigen soll, wo Nacharbeit
 * lohnt. Solche Artikel werden still übergangen.
 *
 * Zwei Merkmale entscheiden: die Spec „Geräteart", wo sie gepflegt ist,
 * und ob überhaupt EIN Pflichtwert dasteht. Wer keinen einzigen hat, ist
 * kein Gerät — wer einen hat, dem fehlen die anderen wirklich.
 */
function istGeraet(specs: SpecEintrag[], vorhanden: number): boolean {
  const art = (specWert(specs, "Geräteart") ?? "").toLowerCase();
  if (art && !/wechselrichter|modul|speicher|batterie/.test(art)) return false;
  return vorhanden > 0;
}

export function moduleAusArtikeln(artikel: Artikel[]): Ergebnis<ModulUebernahme> {
  const fertig: ModulUebernahme[] = [];
  const luecken: Luecke[] = [];
  let uebersprungen = 0;

  for (const a of artikel) {
    const specs = a.tech_specs ?? [];
    const wp = a.modul_wp ?? deutscheZahl(specs.find((e) => e.key === "Nennleistung (STC)")?.value);
    const uoc = deutscheZahl(specWert(specs, "Leerlaufspannung Uoc"));
    const umpp = deutscheZahl(specWert(specs, "MPP-Spannung Umpp"));
    const isc = deutscheZahl(specWert(specs, "Kurzschlussstrom Isc"));
    const impp = deutscheZahl(specWert(specs, "MPP-Strom Impp"));
    const tkProzent = deutscheZahl(specWert(specs, "Temperaturkoeffizient Uoc"));
    const masse = abmessungenMeter(specWert(specs, "Abmessungen"));

    const fehlt: string[] = [];
    if (wp == null) fehlt.push("Nennleistung");
    if (uoc == null) fehlt.push("Leerlaufspannung Uoc");
    if (umpp == null) fehlt.push("MPP-Spannung Umpp");
    if (isc == null) fehlt.push("Kurzschlussstrom Isc");
    if (impp == null) fehlt.push("MPP-Strom Impp");
    if (tkProzent == null) fehlt.push("Temperaturkoeffizient Uoc");
    if (!masse) fehlt.push("Abmessungen");
    /*
     * Ein positiver Koeffizient wäre ein Vorzeichenfehler im Datenblatt
     * oder in der Erfassung. Lieber als Lücke melden, als die Prüfung
     * damit rechnen zu lassen — sie würde zu lange Strings durchwinken.
     */
    if (tkProzent != null && tkProzent >= 0) fehlt.push("Temperaturkoeffizient Uoc (muss negativ sein)");
    if (uoc != null && umpp != null && uoc <= umpp) fehlt.push("Uoc muss über Umpp liegen");

    if (fehlt.length > 0) {
      const belegt = [wp, uoc, umpp, isc, impp, tkProzent, masse].filter((v) => v != null).length;
      if (!istGeraet(specs, belegt)) uebersprungen++;
      else luecken.push({ sku: a.sku, name: a.name, fehlt });
      continue;
    }

    fertig.push({
      artikel_id: a.id,
      hersteller: a.manufacturer ?? "—",
      bezeichnung: a.name,
      wp: wp!,
      uoc: uoc!,
      umpp: umpp!,
      isc: isc!,
      impp: impp!,
      tk_uoc: tkProzent! / 100,
      breite: masse!.breite,
      hoehe: masse!.laenge,
      gewicht: deutscheZahl(specWert(specs, "Gewicht")),
      datenblatt_url: a.datasheet_url,
    });
  }

  return { fertig, luecken, uebersprungen };
}

export interface WrUebernahme {
  artikel_id: string;
  hersteller: string;
  bezeichnung: string;
  max_dc: number;
  ac_nenn: number;
  hybrid: boolean;
  mppt: Array<{ uMin: number; uMax: number; iMax: number; maxStrings: number }>;
  datenblatt_url: string | null;
}

export function wechselrichterAusArtikeln(artikel: Artikel[]): Ergebnis<WrUebernahme> {
  const fertig: WrUebernahme[] = [];
  const luecken: Luecke[] = [];
  let uebersprungen = 0;

  for (const a of artikel) {
    const specs = a.tech_specs ?? [];
    const acNenn = a.wr_kw ?? leistungInKW(specEintrag(specs, "Nennleistung AC"));
    const maxDc = deutscheZahl(specWert(specs, "Max. Eingangsspannung", "Max. DC-Spannung"));
    const fenster = bereich(specWert(specs, "MPP-Spannungsbereich", "Nutzbarer MPP-Spannungsbereich"));
    const iMax = deutscheZahl(specWert(specs, "Max. Strom je MPPT"));
    const anzahl = deutscheZahl(specWert(specs, "MPP-Tracker", "Anzahl MPP-Tracker"));

    const fehlt: string[] = [];
    if (acNenn == null) fehlt.push("Nennleistung AC");
    if (maxDc == null) fehlt.push("max. DC-Spannung");
    if (!fenster) fehlt.push("MPP-Spannungsbereich");
    if (iMax == null) fehlt.push("max. Strom je MPPT");
    if (anzahl == null) fehlt.push("Anzahl MPP-Tracker");

    if (fehlt.length > 0) {
      /*
       * Die AC-Leistung allein macht noch kein Gerät: ein Kabelsatz
       * trägt sie auch. Erst ein DC-Wert — Spannungsgrenze, Fenster,
       * Strom, Trackerzahl — zeigt einen Wechselrichter an.
       */
      const dcBelegt = [maxDc, fenster, iMax, anzahl].filter((v) => v != null).length;
      if (!istGeraet(specs, dcBelegt)) uebersprungen++;
      else luecken.push({ sku: a.sku, name: a.name, fehlt });
      continue;
    }

    /*
     * Alle Tracker gleich belegt: die Datenblätter im Bestand nennen
     * nur EINEN Bereich und EINEN Strom, nicht je Tracker. Wo ein Gerät
     * unterschiedliche Tracker hat, muss das von Hand nachgezogen
     * werden — die Oberfläche kann es.
     */
    const tracker = Array.from({ length: Math.max(1, Math.round(anzahl!)) }, () => ({
      uMin: fenster!.von,
      uMax: fenster!.bis,
      iMax: iMax!,
      maxStrings: 2,
    }));

    const geraeteart = (specWert(specs, "Geräteart") ?? "").toLowerCase();
    fertig.push({
      artikel_id: a.id,
      hersteller: a.manufacturer ?? "—",
      bezeichnung: a.name,
      max_dc: maxDc!,
      ac_nenn: acNenn!,
      // „Hybrid" steht in der Geräteart oder im Namen.
      hybrid: /hybrid/.test(geraeteart) || /hybrid/i.test(a.name),
      mppt: tracker,
      datenblatt_url: a.datasheet_url,
    });
  }

  return { fertig, luecken, uebersprungen };
}

export interface SpeicherUebernahme {
  artikel_id: string;
  hersteller: string;
  bezeichnung: string;
  nutzbar_kwh: number;
  modulgroesse_kwh: number | null;
  datenblatt_url: string | null;
}

export function speicherAusArtikeln(artikel: Artikel[]): Ergebnis<SpeicherUebernahme> {
  const fertig: SpeicherUebernahme[] = [];
  const luecken: Luecke[] = [];
  let uebersprungen = 0;

  for (const a of artikel) {
    const specs = a.tech_specs ?? [];
    const nutzbar = kapazitaetInKWh(
      specEintrag(specs, "Nutzbare Kapazität", "Nutzbare Energie je Modul", "Gesamtkapazität"),
    );
    if (nutzbar == null) {
      /*
       * Ohne jede Kapazitätsangabe ist es kein Speicher, sondern
       * Zubehör aus derselben Kategorie — Sockel, Halter, Kabel.
       */
      const art = (specWert(specs, "Geräteart") ?? "").toLowerCase();
      if (art && !/speicher|batterie/.test(art)) uebersprungen++;
      else luecken.push({ sku: a.sku, name: a.name, fehlt: ["nutzbare Kapazität"] });
      continue;
    }
    fertig.push({
      artikel_id: a.id,
      hersteller: a.manufacturer ?? "—",
      bezeichnung: a.name,
      nutzbar_kwh: nutzbar,
      modulgroesse_kwh: kapazitaetInKWh(specEintrag(specs, "Modulgröße", "Nutzbare Energie je Modul")),
      datenblatt_url: a.datasheet_url,
    });
  }

  return { fertig, luecken, uebersprungen };
}
