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
    jobId: string;
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

type JobZeile = {
  id: string;
  number: string;
  city: string | null;
  zip: string | null;
  scheduled_from: string | null;
  scheduled_to: string | null;
  value_net: string;
  planned_hours: string;
  next_step: string | null;
  phase: { label: string; system_key: string | null } | null;
  customer: { name: string } | null;
};

export async function ladeCockpit(meineId: string): Promise<Cockpit> {
  const supabase = await createClient();
  const heute = viennaDay();
  const wochenStart = startOfViennaWeek(heute);

  const [
    { data: jobs },
    { data: leute },
    { data: rechnungen },
    { data: wocheZeiten },
    { data: laufendRoh },
    { data: lager },
    { data: zertifikate },
    { data: abwesend },
  ] = await Promise.all([
    supabase
      .from("job")
      .select(
        "id, number, city, zip, scheduled_from, scheduled_to, value_net, planned_hours, next_step, phase:phase_id ( label, system_key ), customer:customer_id ( name )",
      )
      .order("scheduled_from", { ascending: true, nullsFirst: false }),
    supabase
      .from("app_user")
      .select("id, name, role, weekly_hours")
      .eq("active", true)
      .order("name"),
    supabase
      .from("invoice")
      .select("id, number, amount_net, paid_amount, due_date, status")
      .not("status", "in", "(paid,draft)"),
    supabase
      .from("time_entry")
      .select("duration_min, kind, user_id")
      .gte("started_at", startOfViennaDay(wochenStart).toISOString())
      .lt("started_at", endOfViennaDay(addDays(wochenStart, 6)).toISOString()),
    supabase
      .from("time_entry")
      .select(
        "id, user_id, job_id, kind, started_at, user:user_id ( name ), job:job_id ( number )",
      )
      .eq("status", "running")
      .order("started_at"),
    supabase.from("v_stock_alert").select("id, sku, name, stock, min_stock"),
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
  ]);

  const jobZeilen = (jobs ?? []) as unknown as JobZeile[];
  const offen = jobZeilen.filter((j) => j.phase?.system_key !== "closed");

  const auftragsbestand = offen.reduce((s, j) => s + Number(j.value_net), 0);

  // --- Auslastung ---
  const kapazitaetProWoche = (leute ?? []).reduce(
    (s, p) => s + Number(p.weekly_hours ?? 0),
    0,
  );
  const auslastung = auslastungJeWoche({
    auftraege: offen.map((j) => ({
      plannedHours: Number(j.planned_hours),
      from: j.scheduled_from ? j.scheduled_from.slice(0, 10) : null,
      to: j.scheduled_to ? j.scheduled_to.slice(0, 10) : null,
    })),
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
    number: string;
    amount_net: string;
    paid_amount: string;
    due_date: string;
    status: string;
  };
  const offeneRechnungen = (rechnungen ?? []) as unknown as Rechnung[];
  const rechnungOffen = offeneRechnungen.reduce(
    (s, r) => s + (Number(r.amount_net) - Number(r.paid_amount)),
    0,
  );
  const ueberfaellige = offeneRechnungen.filter((r) => r.due_date < heute);
  const aelteste = ueberfaellige
    .map((r) => tageSeit(r.due_date, heute))
    .sort((a, b) => b - a)[0];

  // --- Naechster Termin ---
  const kommend = offen
    .filter((j) => j.scheduled_from && j.scheduled_from >= heute)
    .sort((a, b) => (a.scheduled_from! < b.scheduled_from! ? -1 : 1))[0];

  // --- Handlungsbedarf ---
  const handlungsbedarf: Handlung[] = [];

  for (const w of auslastung.slice(0, 4)) {
    if (w.prozent > 100) {
      handlungsbedarf.push({
        ton: "kritisch",
        titel: `${w.label} über Kapazität`,
        detail: `${fmt(w.stunden)} h geplant, ${fmt(kapazitaetProWoche)} h verfügbar`,
        href: "/dispo",
      });
    }
  }

  for (const r of ueberfaellige.slice(0, 3)) {
    handlungsbedarf.push({
      ton: "kritisch",
      titel: `Rechnung ${r.number} überfällig`,
      detail: `${tageSeit(r.due_date, heute)} Tage über Zahlungsziel`,
      href: "/rechnungen",
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

  type Alert = { id: string; sku: string; name: string; stock: string; min_stock: string };
  for (const a of ((lager ?? []) as unknown as Alert[]).slice(0, 3)) {
    handlungsbedarf.push({
      ton: "warn",
      titel: `${a.name} unter Mindestbestand`,
      detail: `${fmt(Number(a.stock))} von ${fmt(Number(a.min_stock))} · ${a.sku}`,
      href: "/lager",
    });
  }

  // --- Team heute ---
  const abwesenheitJe = new Map(
    (abwesend ?? []).map((a) => [a.user_id as string, a.kind as string]),
  );

  type Laufend = {
    id: string;
    user_id: string;
    job_id: string | null;
    kind: string;
    started_at: string;
    user: { name: string } | null;
    job: { number: string } | null;
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
        auftrag: l.job?.number ?? null,
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
  const gesamt = jobZeilen.length;
  const abgeschlossen = jobZeilen.filter(
    (j) => j.phase?.system_key === "closed",
  ).length;

  // --- Laufende Zeit, prominent ---
  const ersteLaufend = laufende[0] ?? null;
  const personenAufAuftrag = ersteLaufend
    ? laufende
        .filter((l) => l.job_id === ersteLaufend.job_id)
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
    stundenWoche: { ist: Math.round(istMin / 6) / 10, soll: kapazitaetProWoche },
    rechnungen: {
      offen: rechnungOffen,
      ueberfaellig: ueberfaellige.length,
      aeltesteTage: aelteste ?? null,
    },
    naechsterTermin: kommend
      ? {
          jobId: kommend.id,
          nummer: kommend.number,
          titel: kommend.next_step ?? kommend.customer?.name ?? kommend.number,
          kunde: kommend.customer?.name ?? "—",
          ort: [kommend.zip, kommend.city].filter(Boolean).join(" "),
          start: kommend.scheduled_from!,
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
          auftragNummer: ersteLaufend.job?.number ?? null,
          auftragId: ersteLaufend.job_id,
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
