import "server-only";
import { auslastungJeWoche, mittlereAuslastung } from "@/lib/rules/auslastung";
import type { Wochenlast } from "@/lib/rules/auslastung";
import { viennaDay } from "@/lib/format";
import { VORWARNUNG_TAGE } from "@/lib/rules/qualifikation";
import { createClient } from "@/lib/supabase/server";
import {
  addDays,
  endOfViennaDay,
  startOfViennaDay,
  startOfViennaWeek,
} from "@/lib/time";

/*
 * Datengrundlage des Cockpits (SPEC 4.1).
 *
 * Alles laeuft ueber den RLS-Client, nicht ueber Service-Role: was eine
 * Rolle nicht sehen darf, faellt hier von selbst weg. Ein Monteur bekommt
 * beim Team-Block nur sich selbst — genau richtig, dafuer musste nichts
 * zusaetzlich geprueft werden.
 *
 * Die Abfragen laufen gebuendelt in zwei Wellen: erst alles Unabhaengige
 * parallel, dann die zwei Nachschlaege, die eine ID aus der ersten Welle
 * brauchen.
 */

/*
 * Kurzfassung der Anliegen-Kategorien. Bewusst dieselben Worte wie auf
 * /service — zwei Bezeichnungen für dasselbe Ticket sind zwei Tickets im
 * Kopf des Lesers.
 */
const KATEGORIE_KURZ: Record<string, string> = {
  stoerung: "Störung",
  frage: "Frage",
  beschwerde: "Beschwerde",
  rechnung: "Rechnungsfrage",
};

export type Handlung = {
  ton: "kritisch" | "warn" | "doing";
  titel: string;
  detail: string;
  href: string;
};

export type TeamZeile = {
  id: string;
  name: string;
  rolle: string;
  status: "eingestempelt" | "pause" | "dienstgang" | "abwesend" | "offen";
  statusText: string;
  seit: string | null;
  auftrag: string | null;
};

export type Cockpit = {
  auftragsbestand: number;
  auftraegeOffen: number;
  bestandVormonatProzent: number | null;
  auslastung: Wochenlast[];
  auslastung4: number;
  kapazitaetProWoche: number;
  stundenWoche: { ist: number; soll: number };
  rechnungen: { offen: number; ueberfaellig: number; aeltesteTage: number | null };
  naechsterTermin: {
    vorgangId: string;
    nummer: string;
    titel: string;
    kunde: string;
    ort: string;
    start: string;
  } | null;
  handlungsbedarf: Handlung[];
  team: TeamZeile[];
  pipeline: { prozent: number; abgeschlossen: number; gesamt: number };
  laufend: {
    seit: string;
    auftragNummer: string | null;
    auftragId: string | null;
    personen: string[];
    eigene: boolean;
  } | null;
};

type VorgangZeile = {
  id: string;
  number: string;
  phase: string;
  ort: string | null;
  plz: string | null;
  customer: { name: string } | null;
};

/* Was nicht abgeschlossen und nicht verloren ist, bindet Kapazität. */
const OFFENE_PHASEN = new Set([
  "anfrage",
  "aufnahme",
  "angebot",
  "beauftragt",
  "montage",
]);

/**
 * Wie viele Werktage der laufenden Woche schon vorbei sind — inklusive
 * heute. Montag ergibt 1, Freitag und Wochenende ergeben 5.
 */
function werktageBisHeute(heute: string): number {
  const wochentag = new Date(`${heute}T12:00:00`).getDay();
  if (wochentag === 0) return 5;
  return Math.min(5, wochentag);
}

export async function ladeCockpit(meineId: string): Promise<Cockpit> {
  const supabase = await createClient();
  const heute = viennaDay();
  const wochenStart = startOfViennaWeek(heute);

  const [
    { data: vorgaenge },
    { data: kpis },
    { data: termine },
    { data: leute },
    { data: rechnungen },
    { data: wocheZeiten },
    { data: laufendRoh },
    { data: lager },
    { data: zertifikate },
    { data: abwesend },
    { data: anliegen },
  ] = await Promise.all([
    supabase
      .from("vorgang")
      .select("id, number, phase, ort, plz, customer:customer_id ( name )")
      .order("number"),
    supabase
      .from("v_vorgang_kpi")
      .select("vorgang_id, auftragswert_netto, soll_stunden"),
    supabase
      .from("vorgang_termin")
      .select("vorgang_id, art, von, bis")
      .order("von"),
    supabase
      .from("app_user")
      .select("id, name, role, weekly_hours")
      .eq("active", true)
      .order("name"),
    supabase
      .from("vorgang_dokument")
      .select("id, nummer, betrag_brutto, faellig_am, status")
      .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
      .in("status", ["versendet"]),
    supabase
      .from("time_entry")
      .select("duration_min, kind, user_id")
      .gte("started_at", startOfViennaDay(wochenStart).toISOString())
      .lt("started_at", endOfViennaDay(addDays(wochenStart, 6)).toISOString()),
    supabase
      .from("time_entry")
      .select(
        "id, user_id, vorgang_id, kind, started_at, user:user_id ( name ), vorgang:vorgang_id ( number )",
      )
      .eq("status", "running")
      .order("started_at"),
    /*
     * bestand statt stock: die alte Spalte wird nur noch von den
     * Altwegen fortgeschrieben, der wahre Bestand entsteht seit 0051 aus
     * den Lagerbewegungen.
     */
    supabase.from("v_stock_alert").select("id, sku, name, bestand, min_stock"),
    supabase
      .from("qualification")
      .select("id, name, valid_until, user:user_id ( name )")
      .not("valid_until", "is", null)
      .lte("valid_until", addDays(heute, VORWARNUNG_TAGE))
      .order("valid_until"),
    supabase
      .from("absence")
      .select("user_id, kind")
      .eq("status", "approved")
      .lte("from_date", heute)
      .gte("to_date", heute),
    /*
     * Offene Serviceanliegen. Der Navigationspunkt "Service" ist
     * gestrichen — Serviceeinsätze leben in Planung und Vorgängen. Das
     * Anliegen selbst entsteht aber vorher: ein Kunde meldet sich über
     * das Portal. Stünde es nirgends, fiele es auf den Boden.
     */
    supabase
      .from("service_ticket")
      .select(
        "id, number, category, body, severity, created_at, customer:customer_id ( name ), einsaetze:einsatz!service_ticket_id ( id )",
      )
      .eq("status", "offen")
      .order("created_at"),
  ]);

  const zeilen = (vorgaenge ?? []) as unknown as VorgangZeile[];
  const offen = zeilen.filter((v) => OFFENE_PHASEN.has(v.phase));

  /*
   * Werte und Soll-Stunden stehen in der View, weil authenticated auf
   * den Spalten selbst kein Recht hat (0025). Rollen ohne Angebotsrecht
   * bekommen eine leere Map — der Bestand steht dann auf null, statt
   * dass die ganze Abfrage scheitert.
   */
  const kpi = new Map(
    (kpis ?? []).map((k) => [
      k.vorgang_id as string,
      {
        wert: Number(k.auftragswert_netto ?? 0),
        sollStunden: Number(k.soll_stunden ?? 0),
      },
    ]),
  );

  const auftragsbestand = offen.reduce(
    (s, v) => s + (kpi.get(v.id)?.wert ?? 0),
    0,
  );

  // --- Auslastung ---
  const kapazitaetProWoche = (leute ?? []).reduce(
    (s, p) => s + Number(p.weekly_hours ?? 0),
    0,
  );

  type Termin = { vorgang_id: string; art: string; von: string; bis: string };
  const alleTermine = (termine ?? []) as unknown as Termin[];
  const montage = new Map<string, Termin>();
  for (const t of alleTermine) {
    if (t.art === "montage" && !montage.has(t.vorgang_id)) {
      montage.set(t.vorgang_id, t);
    }
  }

  const auslastung = auslastungJeWoche({
    auftraege: offen.map((v) => {
      const t = montage.get(v.id);
      return {
        plannedHours: kpi.get(v.id)?.sollStunden ?? 0,
        from: t ? t.von.slice(0, 10) : null,
        to: t ? t.bis.slice(0, 10) : null,
      };
    }),
    kapazitaetProWoche,
    abTag: heute,
  });

  // --- Stunden diese Woche ---
  const istMin = (wocheZeiten ?? [])
    .filter((e) => e.kind !== "break")
    .reduce((s, e) => s + Number(e.duration_min ?? 0), 0);

  // --- Rechnungen ---
  type Rechnung = {
    id: string;
    nummer: string | null;
    betrag_brutto: string | null;
    faellig_am: string | null;
    status: string | null;
  };
  const offeneRechnungen = (rechnungen ?? []) as unknown as Rechnung[];
  const rechnungOffen = offeneRechnungen.reduce(
    (s, r) => s + Number(r.betrag_brutto ?? 0),
    0,
  );
  const ueberfaellige = offeneRechnungen.filter(
    (r) => r.faellig_am !== null && r.faellig_am < heute,
  );
  const aelteste = ueberfaellige
    .map((r) => tageSeit(r.faellig_am as string, heute))
    .sort((a, b) => b - a)[0];

  // --- Naechster Termin ---
  const offeneIds = new Set(offen.map((v) => v.id));
  const naechster = alleTermine
    .filter((t) => offeneIds.has(t.vorgang_id) && t.von.slice(0, 10) >= heute)
    .sort((a, b) => (a.von < b.von ? -1 : 1))[0];
  const kommend = naechster
    ? (offen.find((v) => v.id === naechster.vorgang_id) ?? null)
    : null;

  // --- Handlungsbedarf ---
  const handlungsbedarf: Handlung[] = [];

  for (const w of auslastung.slice(0, 4)) {
    if (w.prozent > 100) {
      handlungsbedarf.push({
        ton: "kritisch",
        titel: `${w.label} über Kapazität`,
        detail: `${fmt(w.stunden)} h geplant, ${fmt(kapazitaetProWoche)} h verfügbar`,
        href: "/planung",
      });
    }
  }

  for (const r of ueberfaellige.slice(0, 3)) {
    handlungsbedarf.push({
      ton: "kritisch",
      titel: `Rechnung ${r.nummer ?? ""} überfällig`.trim(),
      detail: `${tageSeit(r.faellig_am as string, heute)} Tage über Zahlungsziel`,
      href: "/offene-posten",
    });
  }

  type Zert = { id: string; name: string; valid_until: string; user: { name: string } | null };
  for (const z of ((zertifikate ?? []) as unknown as Zert[]).slice(0, 3)) {
    const tage = tageSeit(heute, z.valid_until);
    handlungsbedarf.push({
      ton: tage <= 0 ? "kritisch" : "warn",
      titel:
        tage <= 0
          ? `${z.name} abgelaufen — ${z.user?.name ?? ""}`.trim()
          : `${z.name} läuft ab — ${z.user?.name ?? ""}`.trim(),
      detail: tage <= 0 ? `seit ${-tage} Tagen` : `in ${tage} Tagen`,
      href: "/mitarbeiter",
    });
  }

  type Alert = { id: string; sku: string; name: string; bestand: string; min_stock: string };
  for (const a of ((lager ?? []) as unknown as Alert[]).slice(0, 3)) {
    handlungsbedarf.push({
      ton: "warn",
      titel: `${a.name} unter Mindestbestand`,
      detail: `${fmt(Number(a.bestand))} von ${fmt(Number(a.min_stock))} · ${a.sku}`,
      href: "/lager",
    });
  }

  type Anliegen = {
    id: string;
    number: string | null;
    category: string | null;
    body: string | null;
    severity: number | null;
    created_at: string;
    customer: { name: string } | null;
    einsaetze: { id: string }[] | null;
  };
  /*
   * Anliegen mit Termin verschwinden aus der Liste. Der Status bleibt
   * "offen" — das Ticket ist ja nicht behoben, nur weil jemand hinfährt.
   * Im Handlungsbedarf steht aber, was noch niemand angefasst hat; ein
   * eingeplanter Fall gehört dort nicht mehr hin, sonst zeigt die Karte
   * dauerhaft dieselben drei Zeilen und niemand liest sie noch.
   */
  const ohneTermin = ((anliegen ?? []) as unknown as Anliegen[]).filter(
    (t) => (t.einsaetze ?? []).length === 0,
  );
  for (const t of ohneTermin.slice(0, 3)) {
    const tage = tageSeit(t.created_at.slice(0, 10), heute);
    handlungsbedarf.push({
      /*
       * Stufe 1 ist die Störung, die den Betrieb der Anlage anhält. Und
       * ein Kunde, der seit einer Woche wartet, ist kein Hinweis mehr —
       * egal, wie harmlos die Frage war.
       */
      ton: Number(t.severity) === 1 || tage >= 7 ? "kritisch" : "warn",
      titel: `${KATEGORIE_KURZ[t.category ?? ""] ?? "Anliegen"}: ${
        t.body?.trim().slice(0, 52) || (t.number ?? "ohne Betreff")
      }`,
      detail: `${t.customer?.name ?? "ohne Kunde"} · ${
        tage === 0 ? "heute" : `seit ${tage} Tagen`
      }`,
      href: `/service/${t.id}`,
    });
  }

  // --- Team heute ---
  const abwesenheitJe = new Map(
    (abwesend ?? []).map((a) => [a.user_id as string, a.kind as string]),
  );

  type Laufend = {
    id: string;
    user_id: string;
    vorgang_id: string | null;
    kind: string;
    started_at: string;
    user: { name: string } | null;
    vorgang: { number: string } | null;
  };
  const laufende = (laufendRoh ?? []) as unknown as Laufend[];
  const laufendJe = new Map(laufende.map((l) => [l.user_id, l]));

  const team: TeamZeile[] = (leute ?? []).map((p) => {
    const id = p.id as string;
    const l = laufendJe.get(id);
    const frei = abwesenheitJe.get(id);

    if (l) {
      const status =
        l.kind === "break"
          ? "pause"
          : l.kind === "errand" || l.kind === "travel"
            ? "dienstgang"
            : "eingestempelt";
      return {
        id,
        name: p.name as string,
        rolle: rolleText(p.role as string),
        status,
        statusText:
          status === "pause"
            ? "Pause"
            : status === "dienstgang"
              ? l.kind === "travel"
                ? "Fahrtzeit"
                : "Dienstgang"
              : "eingestempelt",
        seit: l.started_at,
        auftrag: l.vorgang?.number ?? null,
      };
    }

    if (frei) {
      return {
        id,
        name: p.name as string,
        rolle: rolleText(p.role as string),
        status: "abwesend",
        statusText: abwesenheitText(frei),
        seit: null,
        auftrag: null,
      };
    }

    return {
      id,
      name: p.name as string,
      rolle: rolleText(p.role as string),
      status: "offen",
      statusText: "nicht gestempelt",
      seit: null,
      auftrag: null,
    };
  });

  // --- Pipeline-Fortschritt ---
  const gesamt = zeilen.length;
  const abgeschlossen = zeilen.filter((v) => v.phase === "abschluss").length;

  // --- Laufende Zeit, prominent ---
  const ersteLaufend = laufende[0] ?? null;
  const personenAufAuftrag = ersteLaufend
    ? laufende
        .filter((l) => l.vorgang_id === ersteLaufend.vorgang_id)
        .map((l) => l.user?.name ?? "")
        .filter(Boolean)
    : [];

  return {
    auftragsbestand,
    auftraegeOffen: offen.length,
    bestandVormonatProzent: null,
    auslastung,
    auslastung4: mittlereAuslastung(auslastung, 4),
    kapazitaetProWoche,
    stundenWoche: {
      ist: Math.round(istMin / 6) / 10,
      /*
       * Das Soll bis HEUTE, nicht bis Freitag.
       *
       * Vorher stand hier die volle Wochenkapazität: am Mittwochvormittag
       * meldete die Kachel ein Minus von zweihundert Stunden, weil zwei
       * Tage gearbeitet und fünf gerechnet wurden. Eine Zahl, die von
       * Montag bis Donnerstag immer alarmiert, sieht am Freitag niemand
       * mehr an.
       */
      soll: Math.round(kapazitaetProWoche * (werktageBisHeute(heute) / 5) * 10) / 10,
    },
    rechnungen: {
      offen: rechnungOffen,
      ueberfaellig: ueberfaellige.length,
      aeltesteTage: aelteste ?? null,
    },
    naechsterTermin:
      kommend && naechster
        ? {
            vorgangId: kommend.id,
            nummer: kommend.number,
            titel: kommend.customer?.name ?? kommend.number,
            kunde: kommend.customer?.name ?? "—",
            ort: [kommend.plz, kommend.ort].filter(Boolean).join(" "),
            start: naechster.von,
          }
        : null,
    handlungsbedarf: handlungsbedarf.slice(0, 6),
    team,
    pipeline: {
      prozent: gesamt > 0 ? Math.round((abgeschlossen / gesamt) * 100) : 0,
      abgeschlossen,
      gesamt,
    },
    laufend: ersteLaufend
      ? {
          seit: ersteLaufend.started_at,
          auftragNummer: ersteLaufend.vorgang?.number ?? null,
          auftragId: ersteLaufend.vorgang_id,
          personen: personenAufAuftrag,
          eigene: laufende.some((l) => l.user_id === meineId),
        }
      : null,
  };
}

function tageSeit(von: string, bis: string): number {
  const a = new Date(`${von.slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${bis.slice(0, 10)}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

function fmt(n: number): string {
  return new Intl.NumberFormat("de-AT", { maximumFractionDigits: 1 }).format(n);
}

function rolleText(rolle: string): string {
  const map: Record<string, string> = {
    gf: "Geschäftsführung",
    buero: "Büro",
    bauleitung: "Bauleitung",
    monteur: "Montage",
    lager: "Lager",
  };
  return map[rolle] ?? rolle;
}

function abwesenheitText(kind: string): string {
  const map: Record<string, string> = {
    vacation: "Urlaub",
    sick: "Krankenstand",
    leave_comp: "Zeitausgleich",
    care: "Pflegeurlaub",
    school: "Berufsschule",
    special: "Sonderurlaub",
  };
  return map[kind] ?? "abwesend";
}
