/*
 * Dachplanungen für die Vorführung.
 *
 * Der Planer ist das Stück, das im Gespräch gezeigt wird — und ein
 * leerer Planer zeigt nichts. Angelegt werden drei Planungen an echten
 * Vorgängen des Demobestands: ein Einfamilienhaus mit Satteldach, ein
 * Gewerbedach als Flachdach mit Ost/West-Aufständerung und ein
 * Bauernhof mit Pultdach.
 *
 * Gerechnet wird mit denselben Funktionen wie in der Anwendung —
 * `bauAusUmriss`, `autoBelegen`, `verlegeStrings`. Ein Seed, der die
 * Geometrie selbst zusammenschreibt, erzeugt Zustände, die der Planer
 * nie hervorbringen würde, und die Vorführung stolpert darüber.
 *
 * Ausführen:  pnpm tsx scripts/demo-planungen.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { bauAnwenden, bauAusUmriss } from "../lib/planer/bau";
import {
  aktiveZellen,
  autoBelegen,
  kwp,
  type Modulgruppe,
  reihenabstandVorschlag,
} from "../lib/planer/module";
import { leererPlan, type Plan } from "../lib/planer/plan";
import { verlegeStrings } from "../lib/planer/strings";
import { maxModuleProString, minModuleProString } from "../lib/planer/elektrik";
import type { Meter } from "../lib/planer/geo";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((z) => z.includes("=") && !z.trim().startsWith("#"))
    .map((z) => [
      z.slice(0, z.indexOf("=")).trim(),
      z.slice(z.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
    ]),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const COMPANY = "11111111-1111-4111-8111-111111111111";

/** Rechteckiger Grundriss um den Nullpunkt, leicht gedreht. */
function haus(laenge: number, tiefe: number, drehGrad: number): Meter[] {
  const r = (drehGrad * Math.PI) / 180;
  const ecken: Meter[] = [
    { x: -laenge / 2, y: -tiefe / 2 },
    { x: laenge / 2, y: -tiefe / 2 },
    { x: laenge / 2, y: tiefe / 2 },
    { x: -laenge / 2, y: tiefe / 2 },
  ];
  return ecken.map((p) => ({
    x: p.x * Math.cos(r) - p.y * Math.sin(r),
    y: p.x * Math.sin(r) + p.y * Math.cos(r),
  }));
}

interface Vorlage {
  vorgangNummer: string;
  name: string;
  lat: number;
  lon: number;
  laenge: number;
  tiefe: number;
  drehung: number;
  form: "sattel" | "pult" | "flach";
  neigung: number;
  aufbau: "flach" | "sued" | "ost-west" | null;
  verbrauchKwh: number;
  speicherKwh: number | null;
  /**
   * Zielgrösse in kWp.
   *
   * Ein voll belegtes Dach ist geometrisch richtig und trotzdem das
   * falsche Bild: Ein Einfamilienhaus mit zwölf mal neun Metern
   * ergäbe beidseitig belegt zwanzig Kilowatt-Peak — dazu gibt es im
   * Materialstamm gar keinen Wechselrichter, und die elektrische
   * Prüfung stünde in der Vorführung auf Rot. Belegt wird deshalb bis
   * zur Zielgrösse, der Rest des Daches bleibt frei.
   */
  zielKwp: number;
}

/**
 * Ein Feld auf die Zielgrösse stutzen.
 *
 * Weggenommen wird von oben (First) nach unten: Was näher an der
 * Traufe liegt, verschattet weniger und wird zuerst belegt — so
 * belegt ein Betrieb auch wirklich.
 */
function aufZiel(g: Modulgruppe, zielModule: number): Modulgruppe {
  const aktiv = aktiveZellen(g);
  if (aktiv.length <= zielModule) return g;

  const zuviel = aktiv.length - zielModule;
  const weg = [...aktiv]
    .sort((a, b) => b.reihe - a.reihe || b.spalte - a.spalte)
    .slice(0, zuviel)
    .map((z) => `${z.reihe}:${z.spalte}`);

  return { ...g, entfernt: [...(g.entfernt ?? []), ...weg] };
}

const VORLAGEN: Array<Vorlage & { lat: number; lon: number }> = [
  {
    vorgangNummer: "V-2026-2006",
    name: "Sonnleite 7, 4210 Gallneukirchen",
    lat: 48.3549,
    lon: 14.4142,
    laenge: 12.5,
    tiefe: 9,
    drehung: 12,
    form: "sattel",
    neigung: 32,
    aufbau: null,
    verbrauchKwh: 5200,
    speicherKwh: 10,
    zielKwp: 9.8,
  },
  {
    vorgangNummer: "V-2026-2005",
    name: "Industriezeile 44, 4050 Traun",
    lat: 48.2237,
    lon: 14.2394,
    laenge: 34,
    tiefe: 18,
    drehung: 4,
    form: "flach",
    neigung: 0,
    aufbau: "ost-west",
    verbrauchKwh: 78000,
    speicherKwh: null,
    zielKwp: 12,
  },
  {
    vorgangNummer: "V-2026-2003",
    name: "Hofstraße 3, 4070 Eferding",
    lat: 48.3106,
    lon: 14.0233,
    laenge: 26,
    tiefe: 13,
    drehung: -8,
    form: "pult",
    neigung: 18,
    aufbau: null,
    verbrauchKwh: 24000,
    speicherKwh: 15,
    zielKwp: 11.5,
  },
];

/**
 * Adresse in Koordinaten — dieselbe Quelle wie die Adresssuche im
 * Planer.
 *
 * Ohne sie liegt das Dach auf der Wiese neben dem Haus: Die
 * Vorführung zeigt dann eine Anlage, die geometrisch stimmt und im
 * Luftbild neben dem Gebäude schwebt. Antwortet der Dienst nicht,
 * bleibt die hinterlegte Koordinate — eine Planung ohne Bild ist
 * besser als keine.
 */
async function ortSuchen(adresse: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at,de,ch" +
      `&q=${encodeURIComponent(adresse)}`;
    const antwort = await fetch(url, {
      headers: { "User-Agent": "Betriebssoftware Planer (Demobestand)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!antwort.ok) return null;
    const zeilen = (await antwort.json()) as Array<{ lat?: string; lon?: string }>;
    const erste = zeilen[0];
    if (!erste?.lat || !erste?.lon) return null;
    return { lat: Number(erste.lat), lon: Number(erste.lon) };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log("\nPlanungen für die Vorführung\n");

  const [{ data: module }, { data: wrListe }, { data: vorgaenge }] = await Promise.all([
    db.from("planer_modul").select("*").order("wp", { ascending: false }),
    db.from("planer_wechselrichter").select("*"),
    db.from("vorgang").select("id, number, adresse, plz, ort").eq("company_id", COMPANY),
  ]);

  const modul = (module ?? [])[0] as Record<string, unknown> | undefined;
  if (!modul) throw new Error("Kein Modul im Materialstamm.");

  /* Testgeräte gehören nicht in eine Vorführung. */
  const echte = ((wrListe ?? []) as Array<Record<string, unknown>>).filter(
    (w) => !/prüf|probe|schritt|bildhersteller|technik/i.test(String(w.hersteller)),
  );

  await db.from("planer_projekt").delete().eq("company_id", COMPANY);

  for (const v of VORLAGEN) {
    /*
     * Adresse suchen, notfalls nur die Strasse.
     *
     * Die Demokunden haben erfundene Hausnummern — „Sonnleite 7" gibt
     * es in Gallneukirchen nicht. Die STRASSE gibt es meistens schon,
     * und damit liegt das Dach wenigstens im richtigen Wohngebiet
     * statt auf einer Wiese am Ortsrand. Nominatim bittet um eine
     * Anfrage je Sekunde — die halten wir ein.
     */
    const ohneNummer = v.name.replace(/\s\d+,/, ",");
    let gefunden = await ortSuchen(v.name);
    if (!gefunden) {
      await new Promise((f) => setTimeout(f, 1100));
      gefunden = await ortSuchen(ohneNummer);
    }
    if (gefunden) {
      v.lat = gefunden.lat;
      v.lon = gefunden.lon;
    } else {
      console.log(`  (${v.name}: nicht gefunden, hinterlegte Koordinate bleibt)`);
    }
    await new Promise((f) => setTimeout(f, 1100));

    const vorgang = ((vorgaenge ?? []) as Array<{ id: string; number: string }>).find(
      (x) => x.number === v.vorgangNummer,
    );

    /* ── Dach ───────────────────────────────────────────────────── */
    const { plan: mitBau, bau } = bauAusUmriss(leererPlan(), haus(v.laenge, v.tiefe, v.drehung));
    let plan: Plan = bauAnwenden(mitBau, {
      ...bau,
      form: v.form,
      neigung: v.neigung,
      richtung: 0,
    });

    /* ── Belegung ───────────────────────────────────────────────── */
    const typ = {
      breite: Number(modul.breite),
      hoehe: Number(modul.hoehe),
      wp: Number(modul.wp),
      bezeichnung: `${modul.hersteller as string} ${modul.bezeichnung as string}`,
    };

    plan.flaechen.forEach((f, i) => {
      const aufstaenderung =
        v.aufbau === "ost-west" || v.aufbau === "sued"
          ? { art: v.aufbau, winkel: 15 as const }
          : null;
      const gruppe = autoBelegen(f, `g${i + 1}`, `Feld ${i + 1}`, {
        typ,
        ausrichtung: "hoch",
        reihenabstand: aufstaenderung
          ? reihenabstandVorschlag(typ.hoehe, 15, v.lat)
          : 0.02,
        spaltenabstand: 0.02,
        winkel: 0,
        aufstaenderung,
        besetzt: [],
      });
      if (!gruppe) return;

      /*
       * Auf die Zielgrösse stutzen — anteilig, wenn das Dach mehrere
       * Flächen hat. Beim Satteldach bekommt die erste Hälfte alles:
       * Ein Einfamilienhaus wird selten auf beiden Seiten belegt, und
       * die Nordseite schon gar nicht.
       */
      const zielModule = Math.max(
        1,
        Math.round((v.zielKwp * 1000) / typ.wp / (v.form === "sattel" ? 1 : plan.flaechen.length)),
      );
      if (v.form === "sattel" && i > 0) return;

      plan = { ...plan, gruppen: [...plan.gruppen, aufZiel(gruppe, zielModule)] };
    });

    const leistung = plan.gruppen.reduce((s, g) => s + kwp(g), 0);

    /* ── Technik: der Wechselrichter, der zur Leistung passt ────── */
    const wr =
      echte
        .filter((w) => Number(w.ac_nenn) >= leistung * 0.8)
        .sort((a, b) => Number(a.ac_nenn) - Number(b.ac_nenn))[0] ??
      echte.sort((a, b) => Number(b.ac_nenn) - Number(a.ac_nenn))[0];

    plan = {
      ...plan,
      technik: { speicherModule: null,
        modul: modul.id as string,
        wechselrichter: (wr?.id as string) ?? null,
        speicher: null,
      },
      wirtschaft: {
        ...plan.wirtschaft,
        verbrauchKwh: v.verbrauchKwh,
        speicherKwh: v.speicherKwh,
        mitSpeicher: v.speicherKwh !== null,
      },
    };

    /* ── Strings ────────────────────────────────────────────────── */
    if (wr) {
      const elektrik = {
        bezeichnung: typ.bezeichnung,
        wp: typ.wp,
        uoc: Number(modul.uoc),
        umpp: Number(modul.umpp),
        isc: Number(modul.isc),
        impp: Number(modul.impp),
        tkUoc: Number(modul.tk_uoc),
      };
      const mppt = (wr.mppt as Array<Record<string, number>>).map((t) => ({
        uMin: Number(t.uMin),
        uMax: Number(t.uMax),
        iMax: Number(t.iMax),
        maxStrings: Number(t.maxStrings),
      }));
      const wrE = {
        bezeichnung: `${wr.hersteller as string} ${wr.bezeichnung as string}`,
        hybrid: Boolean(wr.hybrid),
        maxDc: Number(wr.max_dc),
        acNenn: Number(wr.ac_nenn),
        mppt,
      };
      const { strings } = verlegeStrings(plan, {
        max: maxModuleProString(elektrik, wrE),
        min: Math.max(1, ...mppt.map((m) => minModuleProString(elektrik, m))),
        mppt: mppt.length,
      });
      plan = { ...plan, strings };
    }

    const { error } = await db.from("planer_projekt").insert({
      company_id: COMPANY,
      name: v.name,
      adresse: v.name,
      ursprung_lat: v.lat,
      ursprung_lon: v.lon,
      anbieter: "basemap",
      zoom: 20,
      plan,
      kwp: Math.round(leistung * 100) / 100,
      ...(vorgang ? { vorgang_id: vorgang.id } : {}),
    });
    if (error) throw new Error(`${v.name}: ${error.message}`);

    console.log(
      `  ${v.name}: ${plan.flaechen.length} Fläche(n), ` +
        `${plan.gruppen.reduce((s, g) => s + g.reihen * g.spalten, 0)} Rasterplätze, ` +
        `${Math.round(leistung * 100) / 100} kWp, ${plan.strings.length} Strings` +
        `${vorgang ? ` — an ${v.vorgangNummer}` : ""}`,
    );
  }

  console.log("\nFertig.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
