/*
 * Der Inhalt des Demobestands: Vorgänge, Material, Planung, Zeiten.
 *
 * Getrennt von demo-neu.ts, weil das Aufräumen und das Aufbauen zwei
 * verschiedene Risiken tragen — das eine löscht, das andere schreibt.
 * Wer nur nachsehen will, was hier entsteht, muss nicht durch die
 * Löschliste lesen.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kunde, Person } from "./demo-neu";

type Ctx = {
  db: SupabaseClient;
  company: string;
  kunden: Kunde[];
  leute: Person[];
  hauptlager: string;
  fahrzeuge: { id: string; name: string; lagerortId: string | null }[];
  uhr: (t: string, hhmm: string) => string;
  tag: (n: number) => string;
  plus: (t: string, n: number) => string;
  montag: () => string;
  istWerktag: (t: string) => boolean;
};

export type VorgangDemo = {
  id: string;
  nummer: string;
  phase: string;
  kunde: Kunde;
  kwp: number;
};

/* ------------------------------------------------------------- VORGÄNGE */

/**
 * Ein Vorgang je Phase — der Durchlauf, den man herzeigt.
 *
 * Die Verteilung ist nicht gleichmässig, sondern so, wie ein Betrieb
 * aussieht: vorne viele Anfragen, in der Mitte wenige laufende Baustellen,
 * hinten das Abgeschlossene. Und ein verlorener Vorgang, weil es den gibt.
 */
const VORGAENGE = [
  { kunde: 0, phase: "montage", kwp: 9.84, speicher: 10, tage: -35, anzahlung: 30 },
  { kunde: 1, phase: "montage", kwp: 29.7, speicher: 20, tage: -42, anzahlung: 30 },
  { kunde: 2, phase: "beauftragt", kwp: 19.8, speicher: 15, tage: -21, anzahlung: 30 },
  { kunde: 3, phase: "beauftragt", kwp: 11.2, speicher: 0, tage: -14, anzahlung: 25 },
  { kunde: 4, phase: "angebot", kwp: 44.0, speicher: 30, tage: -9, anzahlung: 30 },
  { kunde: 5, phase: "angebot", kwp: 8.8, speicher: 10, tage: -5, anzahlung: 30 },
  { kunde: 6, phase: "aufnahme", kwp: 14.3, speicher: 0, tage: -3, anzahlung: 30 },
  { kunde: 7, phase: "anfrage", kwp: 10.5, speicher: 10, tage: -1, anzahlung: 30 },
  { kunde: 3, phase: "abschluss", kwp: 6.6, speicher: 0, tage: -75, anzahlung: 30 },
  { kunde: 5, phase: "verloren", kwp: 12.0, speicher: 0, tage: -60, anzahlung: 30 },
] as const;

export async function vorgaenge(c: Ctx): Promise<VorgangDemo[]> {
  const gf = c.leute.find((l) => l.role === "gf")!;
  const bauleitung = c.leute.find((l) => l.role === "bauleitung")!;

  const zeilen = VORGAENGE.map((v, i) => {
    const k = c.kunden[v.kunde]!;
    const kunde = KUNDENADRESSE[v.kunde]!;
    return {
      company_id: c.company,
      customer_id: k.id,
      number: `V-2026-${String(2001 + i)}`,
      phase: v.phase,
      kwp: v.kwp,
      speicher_kwh: v.speicher || null,
      adresse: kunde.adresse,
      plz: kunde.plz,
      ort: kunde.ort,
      anzahlung_prozent: v.anzahlung,
      zustaendig_user_id: v.phase === "montage" ? bauleitung.id : gf.id,
      phase_seit: c.uhr(c.tag(v.tage), "09:00"),
      created_at: c.uhr(c.tag(v.tage), "08:30"),
      created_by: gf.id,
      ...(v.phase === "verloren"
        ? {
            verloren_grund: "preis",
            verloren_notiz: "Mitbewerber lag 8 % darunter, Kunde hat dort unterschrieben.",
            verloren_am: c.uhr(c.tag(-40), "11:00"),
          }
        : {}),
    };
  });

  const { data, error } = await c.db
    .from("vorgang")
    .insert(zeilen)
    .select("id, number, phase, kwp, customer_id");
  if (error) throw error;

  const liste = (data as { id: string; number: string; phase: string; kwp: number; customer_id: string }[]).map(
    (v) => ({
      id: v.id,
      nummer: v.number,
      phase: v.phase,
      kwp: Number(v.kwp),
      kunde: c.kunden.find((k) => k.id === v.customer_id)!,
    }),
  );

  console.log(`  ${liste.length} Vorgänge über alle Phasen`);
  return liste;
}

const KUNDENADRESSE = [
  { adresse: "Ahornweg 12", plz: "4060", ort: "Leonding" },
  { adresse: "Gewerbepark 8", plz: "4600", ort: "Wels" },
  { adresse: "Hofstraße 3", plz: "4070", ort: "Eferding" },
  { adresse: "Neugasse 16", plz: "4020", ort: "Linz" },
  { adresse: "Industriezeile 44", plz: "4050", ort: "Traun" },
  { adresse: "Sonnleite 7", plz: "4210", ort: "Gallneukirchen" },
  { adresse: "Hauptplatz 2", plz: "4052", ort: "Ansfelden" },
  { adresse: "Am Kirchenberg 5", plz: "4111", ort: "Walding" },
];

/* ------------------------------------------------------------ POSITIONEN */

/**
 * Angebotspositionen aus echten Artikeln.
 *
 * Die Stückzahlen rechnen sich aus der Anlagengrösse: Module aus kWp
 * durch Modulleistung, Klemmen und Schienen je Modul. Eine Demo mit
 * runden Fantasiezahlen fällt jedem Fachmann in der ersten Minute auf.
 */
export async function positionen(c: Ctx, liste: VorgangDemo[]): Promise<void> {
  const { data: artikel } = await c.db
    .from("article")
    .select("id, sku, name, unit, sale_price, purchase_price, kalk_stunden_pro_einheit, modul_wp")
    .eq("company_id", c.company)
    .eq("active", true)
    .in("sku", [
      "MOD-JAS-440",
      "WR-FRO-10",
      "SH-10281",
      "SH-10289",
      "UK-K2-SD",
    ]);

  const nach = new Map(
    ((artikel ?? []) as { sku: string }[]).map((a) => [a.sku, a as never]),
  );

  type Art = {
    id: string;
    sku: string;
    name: string;
    unit: string;
    sale_price: number;
    purchase_price: number;
    kalk_stunden_pro_einheit: number | null;
  };

  const zeilen: Record<string, unknown>[] = [];
  /* Anfragen haben noch keine Positionen — dort wurde nichts gerechnet. */
  for (const v of liste.filter((x) => x.phase !== "anfrage")) {
    const modulzahl = Math.max(6, Math.round((v.kwp * 1000) / 440));
    const bausteine: [string, number][] = [
      ["MOD-JAS-440", modulzahl],
      ["WR-FRO-10", v.kwp > 25 ? 2 : 1],
      ["SH-10281", modulzahl * 2],
      ["SH-10289", Math.ceil(modulzahl / 2)],
      ["UK-K2-SD", Math.ceil(modulzahl / 3)],
    ];

    let sort = 0;
    for (const [sku, menge] of bausteine) {
      const a = nach.get(sku) as Art | undefined;
      if (!a) continue;
      zeilen.push({
        company_id: c.company,
        vorgang_id: v.id,
        sort: (sort += 10),
        article_id: a.id,
        bezeichnung: a.name,
        menge,
        einheit: a.unit ?? "Stk",
        ep_netto: a.sale_price,
        kalk_ek: a.purchase_price,
        kalk_stunden: a.kalk_stunden_pro_einheit ?? 0,
        ist_material: true,
        pos_typ: "material",
      });
    }

    /* Die Leistung dazu — ohne sie ist der Auftragswert reine Ware. */
    zeilen.push({
      company_id: c.company,
      vorgang_id: v.id,
      sort: (sort += 10),
      bezeichnung: "Montage und Inbetriebnahme",
      menge: Math.max(8, Math.round(v.kwp * 1.6)),
      einheit: "Std",
      ep_netto: 68,
      kalk_ek: 42,
      kalk_stunden: 1,
      ist_material: false,
      pos_typ: "leistung",
    });
    zeilen.push({
      company_id: c.company,
      vorgang_id: v.id,
      sort: (sort += 10),
      bezeichnung: "Anfahrt und Baustelleneinrichtung",
      menge: 1,
      einheit: "Pauschale",
      ep_netto: 280,
      kalk_ek: 150,
      kalk_stunden: 0,
      ist_material: false,
      pos_typ: "leistung",
    });
  }

  for (let i = 0; i < zeilen.length; i += 200) {
    const { error } = await c.db.from("vorgang_position").insert(zeilen.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(`  ${zeilen.length} Angebotspositionen`);
}
