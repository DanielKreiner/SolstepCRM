import "server-only";
import { createClient } from "@/lib/supabase/server";

/*
 * Berichte.
 *
 * Alle Auswertungen lesen über den RLS-Client — ein Bericht darf nicht mehr
 * zeigen als der Screen, aus dem er kommt. Wer keine Rechnungen sehen darf,
 * bekommt in der Umsatzauswertung auch keine.
 */

export type Zeitraum = { von: string; bis: string };

export function jahresZeitraum(jahr: number): Zeitraum {
  return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
}

export type Spalte = { key: string; label: string; numerisch?: boolean };

export type Bericht = {
  id: string;
  titel: string;
  hinweis: string;
  spalten: Spalte[];
  zeilen: Record<string, string | number>[];
};

export const BERICHTE = [
  { id: "auftraege", label: "Vorgänge und Nachkalkulation" },
  { id: "umsatz", label: "Umsatz je Monat" },
  { id: "zeiten", label: "Stunden je Person" },
  { id: "material", label: "Materialverbrauch" },
] as const;

export type BerichtId = (typeof BERICHTE)[number]["id"];

export function istBerichtId(v: string): v is BerichtId {
  return BERICHTE.some((b) => b.id === v);
}

export async function baueBericht(
  id: BerichtId,
  zeitraum: Zeitraum,
): Promise<Bericht> {
  switch (id) {
    case "auftraege":
      return auftragsbericht(zeitraum);
    case "umsatz":
      return umsatzbericht(zeitraum);
    case "zeiten":
      return zeitenbericht(zeitraum);
    case "material":
      return materialbericht(zeitraum);
  }
}

async function auftragsbericht(z: Zeitraum): Promise<Bericht> {
  const supabase = await createClient();

  const [{ data: vorgaenge }, { data: kpis }] = await Promise.all([
    supabase
      .from("vorgang")
      .select("id, number, phase, customer:customer_id ( name )")
      .gte("created_at", z.von)
      .lte("created_at", `${z.bis}T23:59:59`)
      .order("number"),
    supabase
      .from("v_vorgang_kpi")
      .select(
        "vorgang_id, auftragswert_netto, soll_stunden, soll_materialkosten, ist_stunden, ist_materialkosten",
      ),
  ]);

  /*
   * Beträge kommen aus der View, nicht aus der Tabelle. Für Rollen ohne
   * Angebotsrecht liefert sie nichts — der Bericht zeigt dann Vorgänge
   * ohne Zahlen statt gar keine Zeile. Das ist gewollt: die Montage
   * darf wissen, dass es den Vorgang gibt.
   */
  const kpi = new Map(
    (kpis ?? []).map((k) => [
      k.vorgang_id as string,
      {
        wert: Number(k.auftragswert_netto ?? 0),
        sollStunden: Number(k.soll_stunden ?? 0),
        sollMaterial: Number(k.soll_materialkosten ?? 0),
        istStunden: Number(k.ist_stunden ?? 0),
        istMaterial: Number(k.ist_materialkosten ?? 0),
      },
    ]),
  );

  return {
    id: "auftraege",
    titel: "Vorgänge und Nachkalkulation",
    hinweis:
      "Beträge netto. Deckungsbeitrag ohne Lohnkosten — der Stundensatz ist " +
      "nicht für jede Rolle lesbar. Soll stammt aus dem angenommenen Angebot.",
    spalten: [
      { key: "nummer", label: "Vorgang" },
      { key: "kunde", label: "Kunde" },
      { key: "phase", label: "Phase" },
      { key: "wert", label: "Auftragswert", numerisch: true },
      { key: "stundenPlan", label: "Stunden Soll", numerisch: true },
      { key: "stundenIst", label: "Stunden Ist", numerisch: true },
      { key: "materialPlan", label: "Material Soll", numerisch: true },
      { key: "materialIst", label: "Material Ist", numerisch: true },
      { key: "db", label: "Nach Material", numerisch: true },
    ],
    zeilen: (vorgaenge ?? []).map((v) => {
      const k = kpi.get(v.id as string);
      const wert = k?.wert ?? 0;
      const materialIst = k?.istMaterial ?? 0;
      return {
        nummer: v.number as string,
        kunde: (v.customer as unknown as { name: string } | null)?.name ?? "",
        phase: v.phase as string,
        wert,
        stundenPlan: Math.round((k?.sollStunden ?? 0) * 10) / 10,
        stundenIst: Math.round((k?.istStunden ?? 0) * 10) / 10,
        materialPlan: Math.round((k?.sollMaterial ?? 0) * 100) / 100,
        materialIst: Math.round(materialIst * 100) / 100,
        db: Math.round((wert - materialIst) * 100) / 100,
      };
    }),
  };
}

async function umsatzbericht(z: Zeitraum): Promise<Bericht> {
  const supabase = await createClient();

  const { data: rechnungen } = await supabase
    .from("vorgang_dokument")
    .select("created_at, betrag_netto, betrag_brutto, status, typ")
    .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
    .in("status", ["versendet", "bezahlt"])
    .gte("created_at", z.von)
    .lte("created_at", `${z.bis}T23:59:59`);

  const proMonat = new Map<
    string,
    { netto: number; ust: number; anzahl: number; bezahlt: number }
  >();

  for (const r of rechnungen ?? []) {
    const monat = String(r.created_at).slice(0, 7);
    const e = proMonat.get(monat) ?? { netto: 0, ust: 0, anzahl: 0, bezahlt: 0 };
    const netto = Number(r.betrag_netto ?? 0);
    e.netto += netto;
    e.ust += Number(r.betrag_brutto ?? 0) - netto;
    e.anzahl += 1;
    if (r.status === "bezahlt") e.bezahlt += netto;
    proMonat.set(monat, e);
  }

  return {
    id: "umsatz",
    titel: "Umsatz je Monat",
    hinweis:
      "Entwürfe und stornierte Rechnungen sind nicht enthalten. Beträge " +
      "netto, USt. gesondert ausgewiesen.",
    spalten: [
      { key: "monat", label: "Monat" },
      { key: "anzahl", label: "Rechnungen", numerisch: true },
      { key: "netto", label: "Netto", numerisch: true },
      { key: "ust", label: "USt.", numerisch: true },
      { key: "brutto", label: "Brutto", numerisch: true },
      { key: "bezahlt", label: "Davon bezahlt", numerisch: true },
    ],
    zeilen: [...proMonat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([monat, e]) => ({
        monat,
        anzahl: e.anzahl,
        netto: Math.round(e.netto * 100) / 100,
        ust: Math.round(e.ust * 100) / 100,
        brutto: Math.round((e.netto + e.ust) * 100) / 100,
        bezahlt: Math.round(e.bezahlt * 100) / 100,
      })),
  };
}

async function zeitenbericht(z: Zeitraum): Promise<Bericht> {
  const supabase = await createClient();

  const [{ data: zeiten }, { data: users }] = await Promise.all([
    supabase
      .from("time_entry")
      .select("user_id, kind, duration_min, status")
      .gte("started_at", z.von)
      .lte("started_at", `${z.bis}T23:59:59`)
      .neq("status", "replaced"),
    supabase.from("app_user").select("id, name, weekly_hours"),
  ]);

  const namen = new Map(
    (users ?? []).map((u) => [u.id as string, u.name as string]),
  );

  const proPerson = new Map<
    string,
    { arbeit: number; fahrt: number; pause: number; sonstiges: number }
  >();

  for (const e of zeiten ?? []) {
    const key = e.user_id as string;
    const p = proPerson.get(key) ?? {
      arbeit: 0,
      fahrt: 0,
      pause: 0,
      sonstiges: 0,
    };
    const min = Number(e.duration_min ?? 0);
    if (e.kind === "work") p.arbeit += min;
    else if (e.kind === "travel") p.fahrt += min;
    else if (e.kind === "break") p.pause += min;
    else p.sonstiges += min;
    proPerson.set(key, p);
  }

  return {
    id: "zeiten",
    titel: "Stunden je Person",
    hinweis:
      "Nur Personen, deren Zeiten deine Rolle sehen darf. Ersetzte Buchungen " +
      "sind nicht enthalten.",
    spalten: [
      { key: "person", label: "Person" },
      { key: "arbeit", label: "Arbeit", numerisch: true },
      { key: "fahrt", label: "Fahrt", numerisch: true },
      { key: "pause", label: "Pause", numerisch: true },
      { key: "sonstiges", label: "Sonstiges", numerisch: true },
      { key: "gesamt", label: "Gesamt ohne Pause", numerisch: true },
    ],
    zeilen: [...proPerson.entries()]
      .map(([id, p]) => ({
        person: namen.get(id) ?? "—",
        arbeit: std(p.arbeit),
        fahrt: std(p.fahrt),
        pause: std(p.pause),
        sonstiges: std(p.sonstiges),
        gesamt: std(p.arbeit + p.fahrt + p.sonstiges),
      }))
      .sort((a, b) => String(a.person).localeCompare(String(b.person))),
  };
}

async function materialbericht(z: Zeitraum): Promise<Bericht> {
  const supabase = await createClient();

  const { data: bewegungen } = await supabase
    .from("stock_move")
    .select("qty, kind, article:article_id ( sku, name, unit, purchase_price )")
    .gte("created_at", z.von)
    .lte("created_at", `${z.bis}T23:59:59`);

  const proArtikel = new Map<
    string,
    { name: string; unit: string; raus: number; rein: number; wert: number }
  >();

  for (const b of bewegungen ?? []) {
    const a = b.article as unknown as {
      sku: string;
      name: string;
      unit: string;
      purchase_price: string;
    } | null;
    if (!a) continue;

    const e = proArtikel.get(a.sku) ?? {
      name: a.name,
      unit: a.unit,
      raus: 0,
      rein: 0,
      wert: 0,
    };
    const menge = Number(b.qty);
    if (b.kind === "out") {
      e.raus += menge;
      e.wert += menge * Number(a.purchase_price);
    } else if (b.kind === "return") {
      e.rein += menge;
      e.wert -= menge * Number(a.purchase_price);
    } else {
      e.rein += menge;
    }
    proArtikel.set(a.sku, e);
  }

  return {
    id: "material",
    titel: "Materialverbrauch",
    hinweis: "Verbrauch = Entnahmen minus Rückgaben, bewertet zum Einkaufspreis.",
    spalten: [
      { key: "sku", label: "Artikelnummer" },
      { key: "name", label: "Bezeichnung" },
      { key: "raus", label: "Entnommen", numerisch: true },
      { key: "rein", label: "Zurück und Eingang", numerisch: true },
      { key: "einheit", label: "Einheit" },
      { key: "wert", label: "Verbrauchswert EK", numerisch: true },
    ],
    zeilen: [...proArtikel.entries()]
      .map(([sku, e]) => ({
        sku,
        name: e.name,
        raus: Math.round(e.raus * 1000) / 1000,
        rein: Math.round(e.rein * 1000) / 1000,
        einheit: e.unit,
        wert: Math.round(e.wert * 100) / 100,
      }))
      .sort((a, b) => Number(b.wert) - Number(a.wert)),
  };
}

function std(minuten: number): number {
  return Math.round((minuten / 60) * 10) / 10;
}

/** CSV mit BOM und Semikolon — so öffnet Excel es unter Windows richtig. */
export function alsCsv(bericht: Bericht): string {
  const kopf = bericht.spalten.map((s) => s.label).join(";");
  const zeilen = bericht.zeilen.map((z) =>
    bericht.spalten
      .map((s) => {
        const wert = z[s.key];
        if (typeof wert === "number") return String(wert).replace(".", ",");
        return /[;"\n]/.test(String(wert ?? ""))
          ? `"${String(wert).replace(/"/g, '""')}"`
          : String(wert ?? "");
      })
      .join(";"),
  );
  return `﻿${[kopf, ...zeilen].join("\r\n")}\r\n`;
}
