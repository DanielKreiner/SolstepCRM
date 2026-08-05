import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanAbwesenheit, PlanEinsatz, PlanPerson } from "./konflikte";

/*
 * Was die Plantafel für eine Woche braucht.
 *
 * Eine Abfragerunde für alles — Einsätze, Personen, Fahrzeuge,
 * Abwesenheiten. Die Tafel ist eine Übersicht; sie nachzuladen, während
 * jemand einen Block zieht, wäre der falsche Moment.
 */

export type EinsatzArt = "auftrag" | "service" | "intern";

export type TafelEinsatz = {
  id: string;
  art: EinsatzArt;
  titel: string;
  von: string;
  bis: string;
  ganztaegig: boolean;
  notiz: string | null;
  subText: string | null;
  fahrzeugId: string | null;
  personen: string[];
  benoetigt: string[];
  vorgangId: string | null;
  vorgangNummer: string | null;
  /** Kunde direkt am Einsatz — für Service ohne Vorgang. */
  kundeId: string | null;
  kundeName: string | null;
  /** Adresse, egal ob sie vom Vorgang oder vom Kunden kommt. */
  adresse: string | null;
  serviceTicketId: string | null;
  serviceTicketNummer: string | null;
  anzahlStopps: number;
  stopps: {
    id: string;
    sort: number;
    name: string;
    adresse: string | null;
    uhrzeit: string | null;
    km: number | null;
    fahrzeitMin: number | null;
  }[];
};

export type TafelAbwesenheit = {
  id: string;
  userId: string;
  von: string;
  bis: string;
  art: string;
  status: string;
};

export type Tafel = {
  personen: (PlanPerson & { rolle: string })[];
  fahrzeuge: { id: string; name: string; kennzeichen: string | null }[];
  einsaetze: TafelEinsatz[];
  abwesenheiten: TafelAbwesenheit[];
};

/** Montag der Woche, in der das Datum liegt. Lokale Tagesgrenze. */
export function wochenStart(d: Date): Date {
  const m = new Date(d);
  const tag = (m.getDay() + 6) % 7; /* Montag = 0 */
  m.setDate(m.getDate() - tag);
  m.setHours(0, 0, 0, 0);
  return m;
}

export function kalenderwoche(d: Date): number {
  /*
   * ISO-8601: die Woche mit dem ersten Donnerstag des Jahres ist KW 1.
   * Die naive Rechnung „Tage seit 1.1. durch 7" liegt Anfang Januar
   * regelmässig um eine Woche daneben.
   */
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - ((t.getUTCDay() + 6) % 7) - 3);
  const jahresbeginn = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      ((t.getTime() - jahresbeginn.getTime()) / 86400000 -
        3 +
        ((jahresbeginn.getUTCDay() + 6) % 7)) /
        7,
    )
  );
}

export async function tafelLaden(
  supabase: SupabaseClient,
  von: Date,
  bis: Date,
): Promise<Tafel> {
  const [{ data: leute }, { data: autos }, { data: einsaetze }, { data: abw }] =
    await Promise.all([
      supabase
        .from("app_user")
        .select("id, name, role, qualifikationen")
        .eq("active", true)
        .order("name"),
      supabase
        .from("fahrzeug")
        .select("id, name, kennzeichen")
        .eq("aktiv", true)
        .order("sort"),
      supabase
        .from("einsatz")
        .select(
          `id, art, titel, von, bis, ganztaegig, notiz, sub_text, fahrzeug_id,
           benoetigte_qualifikationen, vorgang_id, kunde_id, service_ticket_id,
           personen:einsatz_person ( user_id ),
           stopps:einsatz_stopp ( id, sort, name, adresse, uhrzeit, km, fahrzeit_min ),
           vorgang:vorgang_id ( number, adresse, plz, ort, customer:customer_id ( name ) ),
           kunde:kunde_id ( name, street, zip, city ),
           anliegen:service_ticket_id ( number )`,
        )
        /* Alles, was in die Woche hineinragt — auch was davor beginnt. */
        .lt("von", bis.toISOString())
        .gt("bis", von.toISOString())
        .order("von"),
      supabase
        .from("absence")
        .select("id, user_id, kind, from_date, to_date, status")
        .lte("from_date", bis.toISOString().slice(0, 10))
        .gte("to_date", von.toISOString().slice(0, 10)),
    ]);

  return {
    personen: ((leute ?? []) as unknown as {
      id: string;
      name: string;
      role: string;
      qualifikationen: string[] | null;
    }[]).map((u) => ({
      id: u.id,
      name: u.name,
      rolle: u.role,
      qualifikationen: u.qualifikationen ?? [],
    })),

    fahrzeuge: ((autos ?? []) as unknown as {
      id: string;
      name: string;
      kennzeichen: string | null;
    }[]).map((f) => ({ id: f.id, name: f.name, kennzeichen: f.kennzeichen })),

    einsaetze: ((einsaetze ?? []) as unknown as EinsatzRoh[]).map((e) => {
      const v = e.vorgang as unknown as {
        number: string;
        adresse: string | null;
        plz: string | null;
        ort: string | null;
        customer: { name: string } | null;
      } | null;
      const k = e.kunde as unknown as {
        name: string;
        street: string | null;
        zip: string | null;
        city: string | null;
      } | null;
      const t = e.anliegen as unknown as { number: string | null } | null;

      /*
       * Die Adresse kommt vom Vorgang, wenn es einen gibt — dort steht
       * die Baustelle, und die ist nicht zwingend die Rechnungsadresse
       * des Kunden. Ohne Vorgang bleibt der Kundensitz.
       */
      const adresse =
        [v?.adresse, [v?.plz, v?.ort].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ") ||
        [k?.street, [k?.zip, k?.city].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ") ||
        null;

      return {
        id: e.id,
        art: e.art as EinsatzArt,
        titel: e.titel ?? v?.customer?.name ?? k?.name ?? "Einsatz",
        von: e.von,
        bis: e.bis,
        ganztaegig: e.ganztaegig,
        notiz: e.notiz,
        subText: e.sub_text,
        fahrzeugId: e.fahrzeug_id,
        personen: (e.personen ?? []).map((p) => p.user_id),
        benoetigt: e.benoetigte_qualifikationen ?? [],
        vorgangId: e.vorgang_id,
        vorgangNummer: v?.number ?? null,
        kundeId: e.kunde_id,
        kundeName: v?.customer?.name ?? k?.name ?? null,
        adresse,
        serviceTicketId: e.service_ticket_id,
        serviceTicketNummer: t?.number ?? null,
        anzahlStopps: (e.stopps ?? []).length,
        stopps: (e.stopps ?? [])
          .slice()
          .sort((a, b) => a.sort - b.sort)
          .map((x) => ({
            id: x.id,
            sort: x.sort,
            name: x.name,
            adresse: x.adresse,
            uhrzeit: x.uhrzeit,
            km: x.km === null ? null : Number(x.km),
            fahrzeitMin: x.fahrzeit_min,
          })),
      };
    }),

    abwesenheiten: ((abw ?? []) as unknown as {
      id: string;
      user_id: string;
      kind: string;
      from_date: string;
      to_date: string;
      status: string;
    }[]).map((a) => ({
      id: a.id,
      userId: a.user_id,
      von: a.from_date,
      bis: a.to_date,
      art: a.kind,
      status: a.status,
    })),
  };
}

/**
 * Die Prüfform der Daten.
 *
 * Nur genehmigte Abwesenheiten sperren. Ein offener Antrag ist eine
 * Absicht — daran die Planung zu blockieren hiesse, dass jeder
 * Mitarbeiter den Dienstplan durch einen Antrag festhalten kann.
 */
export function alsPruefdaten(t: Tafel): {
  bestand: PlanEinsatz[];
  personen: PlanPerson[];
  abwesenheiten: PlanAbwesenheit[];
} {
  return {
    bestand: t.einsaetze.map((e) => ({
      id: e.id,
      von: e.von,
      bis: e.bis,
      personen: e.personen,
      fahrzeugId: e.fahrzeugId,
      titel: e.titel,
    })),
    personen: t.personen.map((p) => ({
      id: p.id,
      name: p.name,
      qualifikationen: p.qualifikationen,
    })),
    abwesenheiten: t.abwesenheiten
      .filter((a) => a.status === "approved")
      .map((a) => ({ userId: a.userId, von: a.von, bis: a.bis, art: a.art })),
  };
}

type EinsatzRoh = {
  id: string;
  art: string;
  titel: string | null;
  von: string;
  bis: string;
  ganztaegig: boolean;
  notiz: string | null;
  sub_text: string | null;
  fahrzeug_id: string | null;
  benoetigte_qualifikationen: string[] | null;
  vorgang_id: string | null;
  kunde_id: string | null;
  service_ticket_id: string | null;
  personen: { user_id: string }[] | null;
  stopps:
    | {
        id: string;
        sort: number;
        name: string;
        adresse: string | null;
        uhrzeit: string | null;
        km: string | null;
        fahrzeit_min: number | null;
      }[]
    | null;
  vorgang: unknown;
  kunde: unknown;
  anliegen: unknown;
};
