import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tageshinweis } from "@/lib/rules/tagesbild";
import { arbeitstageImMonat, istArbeitstag } from "@/lib/zeiten/feiertage";
import { addDays, endOfViennaDay, startOfViennaDay } from "@/lib/time";

/**
 * Die eine Zeiten-Quelle.
 *
 * Live-Anwesenheit, Tagesliste, Woche und Saldo lesen alle dieselbe
 * Abfrage. Vorher war das nicht so — dann stand „niemand eingestempelt"
 * neben einer Tabelle mit Kommt-Zeiten, und niemand wusste, welche der
 * beiden Anzeigen lügt.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type ZeitZeile = {
  id: string;
  userId: string;
  name: string;
  /** work | break | travel | errand | training. */
  art: string;
  von: string;
  bis: string | null;
  /** Arbeitsminuten. Bei einer Pausenbuchung null — sie ist keine Arbeit. */
  minuten: number;
  pauseMin: number;
  status: string;
  quelle: string;
  einsatzId: string | null;
  einsatzTitel: string | null;
  vorgangNummer: string | null;
  kunde: string | null;
  /** Auffällig: automatisch beendet, markiert oder ohne Einsatz. */
  zuPruefen: boolean;
};

export type TagesPerson = {
  userId: string;
  name: string;
  rolle: string;
  istMin: number;
  pauseMin: number;
  sollMin: number;
  laeuftSeit: string | null;
  laeuftAn: string | null;
  /** Klartext aus lib/rules/tagesbild — warum jemand hinsehen sollte. */
  hinweis: string | null;
  zeilen: ZeitZeile[];
};

export type Tagesbild = {
  tag: string;
  personen: TagesPerson[];
  /** Wer gerade eingestempelt ist — dieselbe Abfrage wie die Liste. */
  eingestempelt: number;
  istGesamtMin: number;
  zuPruefen: number;
  offeneKorrekturen: number;
};

const FELDER = `id, user_id, started_at, ended_at, duration_min, auto_break_min,
   kind, status, quelle, einsatz_id, flagged_reason,
   person:user_id ( name, role, weekly_hours, location:location_id ( holiday_region ) ),
   einsatz:einsatz_id ( art, titel, vorgang:vorgang_id ( number, customer:customer_id ( name ) ) )`;

type Roh = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  auto_break_min: number;
  kind: string;
  status: string;
  quelle: string;
  einsatz_id: string | null;
  flagged_reason: string | null;
  person: {
    name: string;
    role: string;
    weekly_hours: number;
    location: { holiday_region: string | null } | null;
  } | null;
  einsatz: {
    art: string;
    titel: string | null;
    vorgang: { number: string; customer: { name: string } | null } | null;
  } | null;
};

function abbilden(e: Roh): ZeitZeile {
  const dauer =
    e.duration_min ??
    (e.ended_at
      ? Math.round(
          (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) /
            60_000,
        )
      : 0);

  return {
    id: e.id,
    userId: e.user_id,
    name: e.person?.name ?? "—",
    art: e.kind,
    von: e.started_at,
    bis: e.ended_at,
    /*
     * Eine Pausenbuchung ist keine Arbeitszeit. Vor dieser Zeile zählte
     * sie mit — wer eine halbe Stunde Pause stempelte, bekam sie als
     * Guthaben gutgeschrieben statt abgezogen.
     */
    minuten: e.kind === "break" ? 0 : Math.max(0, dauer - (e.auto_break_min ?? 0)),
    pauseMin: e.kind === "break" ? dauer : (e.auto_break_min ?? 0),
    status: e.status,
    quelle: e.quelle,
    einsatzId: e.einsatz_id,
    einsatzTitel: e.einsatz?.titel ?? null,
    vorgangNummer: e.einsatz?.vorgang?.number ?? null,
    kunde: e.einsatz?.vorgang?.customer?.name ?? null,
    /*
     * Auffällig ist, was jemand ansehen sollte: markierte Buchungen und
     * Zeiten ohne Einsatz. Letztere darf es nicht mehr geben — solange
     * Altdaten da sind, fallen sie hier auf.
     */
    zuPruefen:
      e.status === "flagged" || (e.kind !== "break" && e.einsatz_id === null),
  };
}

/** Sollminuten einer Person an einem Tag. */
function sollFuerTag(
  tag: string,
  wochenstunden: number,
  region: string | null,
  abwesend: boolean,
): number {
  if (abwesend) return 0;
  if (!istArbeitstag(tag, region)) return 0;
  return Math.round((wochenstunden / 5) * 60);
}

export async function tagesbild(
  supabase: Client,
  d: { tag: string },
): Promise<Tagesbild> {
  const von = startOfViennaDay(d.tag).toISOString();
  const bis = endOfViennaDay(d.tag).toISOString();

  const [{ data: roh }, { data: leute }, { data: abwesenheiten }, { count: korrekturen }] =
    await Promise.all([
      supabase
        .from("time_entry")
        .select(FELDER)
        .neq("status", "replaced")
        .gte("started_at", von)
        .lte("started_at", bis)
        .order("started_at"),
      supabase
        .from("app_user")
        .select("id, name, role, weekly_hours, location:location_id ( holiday_region )")
        .eq("active", true)
        .order("name"),
      supabase
        .from("absence")
        .select("user_id")
        .eq("status", "approved")
        .lte("from_date", d.tag)
        .gte("to_date", d.tag),
      supabase
        .from("time_correction")
        .select("id", { count: "exact", head: true })
        .eq("status", "requested"),
    ]);

  const zeilen = ((roh ?? []) as unknown as Roh[]).map(abbilden);
  const abwesend = new Set(
    ((abwesenheiten ?? []) as { user_id: string }[]).map((a) => a.user_id),
  );

  const personen: TagesPerson[] = (
    (leute ?? []) as unknown as {
      id: string;
      name: string;
      role: string;
      weekly_hours: number;
      location: { holiday_region: string | null } | null;
    }[]
  ).map((u) => {
    const meine = zeilen.filter((z) => z.userId === u.id);
    const laufend = meine.find((z) => z.bis === null);
    const istMin = meine.reduce((s, z) => s + z.minuten, 0);
    const pauseMin = meine.reduce((s, z) => s + z.pauseMin, 0);

    return {
      userId: u.id,
      name: u.name,
      rolle: u.role,
      istMin,
      pauseMin,
      sollMin: sollFuerTag(
        d.tag,
        Number(u.weekly_hours ?? 0),
        u.location?.holiday_region ?? null,
        abwesend.has(u.id),
      ),
      laeuftSeit: laufend?.von ?? null,
      laeuftAn: laufend?.einsatzId ?? null,
      hinweis: tageshinweis({
        istMin,
        pauseMin,
        geflaggt: meine.some((z) => z.status === "flagged"),
        ohneEinsatz: meine.some((z) => z.art !== "break" && z.einsatzId === null),
      }),
      zeilen: meine,
    };
  });

  return {
    tag: d.tag,
    personen,
    /*
     * Dieselbe Liste, nur anders gezählt: eine Kachel, die aus einer
     * zweiten Abfrage stammt, widerspricht der Tabelle darunter früher
     * oder später.
     */
    eingestempelt: personen.filter((p) => p.laeuftSeit).length,
    istGesamtMin: personen.reduce((s, p) => s + p.istMin, 0),
    zuPruefen: zeilen.filter((z) => z.zuPruefen).length,
    offeneKorrekturen: korrekturen ?? 0,
  };
}

export type WochenPerson = {
  userId: string;
  name: string;
  tage: { tag: string; istMin: number; sollMin: number; offen: number }[];
  istMin: number;
  sollMin: number;
  /** Wie viele Zeiten der Woche noch nicht genehmigt sind. */
  offen: number;
};

export type Wochenbild = {
  tage: string[];
  personen: WochenPerson[];
};

export async function wochenbild(
  supabase: Client,
  d: { montag: string },
): Promise<Wochenbild> {
  const tage = Array.from({ length: 7 }, (_, i) => addDays(d.montag, i));
  const von = startOfViennaDay(tage[0]!).toISOString();
  const bis = endOfViennaDay(tage[6]!).toISOString();

  const [{ data: roh }, { data: leute }, { data: abwesenheiten }] = await Promise.all([
    supabase
      .from("time_entry")
      .select(FELDER)
      .neq("status", "replaced")
      .gte("started_at", von)
      .lte("started_at", bis)
      .order("started_at"),
    supabase
      .from("app_user")
      .select("id, name, weekly_hours, location:location_id ( holiday_region )")
      .eq("active", true)
      .order("name"),
    supabase
      .from("absence")
      .select("user_id, from_date, to_date")
      .eq("status", "approved")
      .lte("from_date", tage[6]!)
      .gte("to_date", tage[0]!),
  ]);

  const zeilen = ((roh ?? []) as unknown as Roh[]).map(abbilden);

  const personen = (
    (leute ?? []) as unknown as {
      id: string;
      name: string;
      weekly_hours: number;
      location: { holiday_region: string | null } | null;
    }[]
  ).map((u) => {
    const region = u.location?.holiday_region ?? null;
    const meine = zeilen.filter((z) => z.userId === u.id);

    const jeTag = tage.map((tag) => {
      const amTag = meine.filter((z) => z.von.slice(0, 10) === tag);
      const abwesend = ((abwesenheiten ?? []) as {
        user_id: string;
        from_date: string;
        to_date: string;
      }[]).some(
        (a) => a.user_id === u.id && a.from_date <= tag && a.to_date >= tag,
      );

      return {
        tag,
        istMin: amTag.reduce((s, z) => s + z.minuten, 0),
        sollMin: sollFuerTag(tag, Number(u.weekly_hours ?? 0), region, abwesend),
        offen: amTag.filter((z) => z.status !== "approved").length,
      };
    });

    return {
      userId: u.id,
      name: u.name,
      tage: jeTag,
      istMin: jeTag.reduce((s, t) => s + t.istMin, 0),
      sollMin: jeTag.reduce((s, t) => s + t.sollMin, 0),
      offen: jeTag.reduce((s, t) => s + t.offen, 0),
    };
  });

  return { tage, personen };
}

export type KontoPerson = {
  userId: string;
  name: string;
  /** Zwölf Monate Ist gegen Soll. */
  verlauf: { monat: string; istMin: number; sollMin: number }[];
  saldoMin: number;
  resturlaub: number;
  offeneKorrekturen: number;
};

/**
 * Der Saldo wird abgeleitet, nie gebucht.
 *
 * Ist sind die genehmigten Zeiten, Soll das Arbeitszeitmodell abzüglich
 * Feiertagen und Abwesenheiten. Wenn der Saldo falsch aussieht, ist die
 * Ursache falsch — eine Korrekturbuchung auf das Ergebnis verdeckt sie
 * nur.
 */
export async function konten(
  supabase: Client,
  d: { bis: string },
): Promise<KontoPerson[]> {
  const monate: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const dd = new Date(`${d.bis.slice(0, 8)}01T12:00:00Z`);
    dd.setUTCMonth(dd.getUTCMonth() - i);
    monate.push(dd.toISOString().slice(0, 7));
  }

  const [{ data: leute }, { data: roh }, { data: abwesenheiten }, { data: korrekturen }] =
    await Promise.all([
      supabase
        .from("app_user")
        .select(
          "id, name, weekly_hours, vacation_days_year, vacation_carry, location:location_id ( holiday_region )",
        )
        .eq("active", true)
        .order("name"),
      supabase
        .from("time_entry")
        .select("user_id, started_at, duration_min, auto_break_min, status")
        .eq("status", "approved")
        .gte("started_at", `${monate[0]}-01T00:00:00Z`),
      supabase
        .from("absence")
        .select("user_id, kind, from_date, to_date, half_day")
        .eq("status", "approved")
        .gte("to_date", `${monate[0]}-01`),
      supabase
        .from("time_correction")
        .select("id, user_id")
        .eq("status", "requested"),
    ]);

  const zeiten = (roh ?? []) as unknown as {
    user_id: string;
    started_at: string;
    duration_min: number | null;
    auto_break_min: number;
  }[];

  const abwesend = (abwesenheiten ?? []) as unknown as {
    user_id: string;
    kind: string;
    from_date: string;
    to_date: string;
    half_day: boolean;
  }[];

  const offeneJePerson = new Map<string, number>();
  for (const k of (korrekturen ?? []) as unknown as { user_id: string }[]) {
    offeneJePerson.set(k.user_id, (offeneJePerson.get(k.user_id) ?? 0) + 1);
  }

  return (
    (leute ?? []) as unknown as {
      id: string;
      name: string;
      weekly_hours: number;
      vacation_days_year: number;
      vacation_carry: number;
      location: { holiday_region: string | null } | null;
    }[]
  ).map((u) => {
    const region = u.location?.holiday_region ?? null;
    const tagesSoll = (Number(u.weekly_hours ?? 0) / 5) * 60;

    const verlauf = monate.map((monat) => {
      const istMin = zeiten
        .filter((z) => z.user_id === u.id && z.started_at.slice(0, 7) === monat)
        .reduce(
          (s, z) => s + Math.max(0, (z.duration_min ?? 0) - (z.auto_break_min ?? 0)),
          0,
        );

      /* Abwesenheitstage erfüllen das Soll — sie senken es. */
      const freieTage = abwesend
        .filter((a) => a.user_id === u.id)
        .reduce((s, a) => {
          let zahl = 0;
          const start = a.from_date > `${monat}-01` ? a.from_date : `${monat}-01`;
          const ende = a.to_date;
          const d0 = new Date(`${start}T12:00:00Z`);
          const d1 = new Date(`${ende}T12:00:00Z`);
          while (d0 <= d1) {
            const tag = d0.toISOString().slice(0, 10);
            if (tag.slice(0, 7) === monat && istArbeitstag(tag, region)) {
              zahl += a.half_day ? 0.5 : 1;
            }
            d0.setUTCDate(d0.getUTCDate() + 1);
          }
          return s + zahl;
        }, 0);

      const arbeitstage = arbeitstageImMonat(monat, region);
      const sollMin = Math.round(Math.max(0, arbeitstage - freieTage) * tagesSoll);

      return { monat, istMin, sollMin };
    });

    const verbraucht = abwesend
      .filter((a) => a.user_id === u.id && a.kind === "urlaub")
      .reduce((s, a) => {
        const tage =
          (new Date(a.to_date).getTime() - new Date(a.from_date).getTime()) /
            86_400_000 +
          1;
        return s + (a.half_day ? 0.5 : tage);
      }, 0);

    return {
      userId: u.id,
      name: u.name,
      verlauf,
      saldoMin: verlauf.reduce((s, m) => s + (m.istMin - m.sollMin), 0),
      resturlaub:
        Number(u.vacation_days_year ?? 0) +
        Number(u.vacation_carry ?? 0) -
        verbraucht,
      offeneKorrekturen: offeneJePerson.get(u.id) ?? 0,
    };
  });
}
