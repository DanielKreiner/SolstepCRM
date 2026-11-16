"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { anzahlung } from "@/lib/vorgang/modell";
import { belegPreis, nettoAus, rahmenLaden } from "@/lib/vorgang/belegpreis";
import {
  restbetrag,
  STORNIERBAR,
  STORNO_FEHLER,
  stornoPruefen,
  ZAHLUNG_FEHLER,
  zahlungBuchen,
} from "@/lib/vorgang/zahlung";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type RechnungStatus = { error: string | null; ok: string | null };

/**
 * Rechnungen am Vorgang — Anzahlung, Schluss, Zahlung.
 *
 * Kein Fibu-Modul (Briefing Abschnitt 8). Was hier entsteht, ist ein
 * Dokument mit Betrag, Fälligkeit und drei Zuständen:
 * entwurf → versendet → bezahlt. Alles Weitere macht die Buchhaltung.
 */

type Zugang =
  | { ok: true; me: Awaited<ReturnType<typeof requireMe>> }
  | { ok: false; status: RechnungStatus };

async function zugang(): Promise<Zugang> {
  const me = await requireMe();
  if (me.perms.rechnungen !== "write") {
    return {
      ok: false,
      status: { error: "Für Rechnungen fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  if (me.company.status !== "active") {
    return { ok: false, status: { error: "Der Zugang ist derzeit nur lesend.", ok: null } };
  }
  return { ok: true, me };
}

function frisch(vorgangId: string): void {
  revalidatePath(`/vorgaenge/${vorgangId}`);
  revalidatePath("/offene-posten");
  revalidatePath("/vorgaenge");
}

/* ------------------------------------------------- SCHLUSSRECHNUNG */

const schlussSchema = z.object({ vorgangId: z.string().uuid() });

/**
 * Schlussrechnung: Auftragswert minus Anzahlung.
 *
 * Die Positionen kommen aus der angenommenen Fassung, nicht aus dem
 * lebenden Entwurf — sonst rechnet die Schlussrechnung etwas ab, das nie
 * beauftragt war.
 */
export async function schlussrechnungErstellen(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = schlussSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const { vorgangId } = parsed.data;

  const supabase = await createClient();

  const { data: v } = await supabase
    .from("vorgang")
    .select("id, number, phase, anzahlung_prozent")
    .eq("id", vorgangId)
    .maybeSingle();

  if (!v) return { error: "Vorgang nicht gefunden.", ok: null };
  if (v.phase !== "abschluss" && v.phase !== "montage") {
    return {
      error: "Eine Schlussrechnung gibt es erst, wenn die Montage läuft oder fertig ist.",
      ok: null,
    };
  }

  /*
   * Zweimal erstellen darf keine zweite Rechnung erzeugen — eine
   * stornierte zählt dabei aber nicht mehr.
   *
   * Vorher stand hier `.eq("typ", "schlussrechnung").maybeSingle()`.
   * Das war in zwei Richtungen falsch, sobald es ein Storno gibt: der
   * stornierte Beleg hat die Neuausstellung blockiert (CLAUDE.md 6.4
   * verlangt genau diesen Weg), und nach einer Neuausstellung hätte
   * `maybeSingle()` bei zwei Zeilen einen Fehler geliefert statt einer
   * Zeile — die Rechnung wäre dann endgültig nicht mehr erstellbar.
   */
  const { data: schonDa } = await supabase
    .from("vorgang_dokument")
    .select("id, nummer")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "schlussrechnung")
    .neq("status", "storniert")
    .order("created_at", { ascending: false })
    .limit(1);

  const bestehend = (schonDa ?? [])[0];
  if (bestehend) {
    return {
      error: null,
      ok: `Schlussrechnung ${bestehend.nummer as string} besteht bereits.`,
    };
  }

  /* Die eingefrorene Fassung: das ist der Auftrag. */
  const { data: ab } = await supabase
    .from("vorgang_dokument")
    .select("id")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "ab")
    .maybeSingle();

  if (!ab) {
    return { error: "Ohne Auftragsbestätigung gibt es keinen Auftragswert.", ok: null };
  }

  /*
   * Gerechnet wird mit derselben Formel wie im Angebot. Vorher stand hier
   * `summen()`, das `menge × ep_netto` addiert — ohne Positionsrabatt,
   * ohne Paketpreis einer Gruppe, ohne Lieferkosten und ohne die nicht
   * gewählten Optionen auszunehmen. Die Rechnung forderte dadurch einen
   * anderen Betrag, als das Angebot ausgewiesen hatte.
   */
  const [{ data: posRoh }, { data: gruppenRoh }] = await Promise.all([
    supabase
      .from("vorgang_position")
      .select(
        "id, gruppe_id, menge, ep_netto, rabatt_prozent, optional, kunden_auswahl, kalk_ek",
      )
      .eq("dokument_id", ab.id),
    supabase
      .from("vorgang_gruppe")
      .select("id, paket_preis")
      .eq("dokument_id", ab.id),
  ]);

  const rahmen = await rahmenLaden(supabase, vorgangId);
  const ustSatz = rahmen.ustSatz;
  const preis = belegPreis(
    (posRoh ?? []) as unknown as Parameters<typeof belegPreis>[0],
    (gruppenRoh ?? []) as unknown as Parameters<typeof belegPreis>[1],
    rahmen,
  );

  /*
   * Abgezogen wird die tatsächlich gestellte Anzahlung, nicht der
   * Prozentsatz von heute. Ändert jemand nachträglich die 30 auf 40, darf
   * die Schlussrechnung nicht plötzlich zu wenig fordern.
   */
  /*
   * Eine stornierte Anzahlungsrechnung ist keine gestellte Anzahlung.
   * Würde sie mitgerechnet, forderte die Schlussrechnung zu wenig —
   * und der Rest käme nie herein. Mehrere Zeilen sind nach einem
   * Storno mit Neuausstellung möglich, deshalb kein `maybeSingle()`.
   */
  const { data: anzRows } = await supabase
    .from("vorgang_dokument")
    .select("betrag_brutto")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "anzahlungsrechnung")
    .neq("status", "storniert")
    .order("created_at", { ascending: false })
    .limit(1);

  const anz = (anzRows ?? [])[0];
  const anzahlungBrutto = anz?.betrag_brutto
    ? Number(anz.betrag_brutto)
    : anzahlung(preis.gesamt, Number(v.anzahlung_prozent)).anzahlungBrutto;

  const rest = Math.round((preis.gesamt - anzahlungBrutto) * 100) / 100;
  if (rest <= 0) {
    return {
      error: "Die Anzahlung deckt den Auftragswert bereits ab — keine Schlussrechnung nötig.",
      ok: null,
    };
  }

  const { data: nr } = await supabase.rpc("next_number", {
    p_company: z1.me.companyId,
    p_kind: "invoice",
  });
  if (typeof nr !== "string") {
    return { error: "Nummer konnte nicht vergeben werden.", ok: null };
  }

  const faellig = new Date();
  faellig.setDate(faellig.getDate() + 14);

  const { data: dok, error } = await supabase
    .from("vorgang_dokument")
    .insert({
      company_id: z1.me.companyId,
      vorgang_id: vorgangId,
      typ: "schlussrechnung",
      nummer: nr,
      dateiname: `Schlussrechnung ${nr}.pdf`,
      betrag_netto: nettoAus(rest, ustSatz),
      betrag_brutto: rest,
      status: "entwurf",
      faellig_am: faellig.toISOString().slice(0, 10),
      created_by: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !dok) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message}`, ok: null };
  }

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: vorgangId,
    typ: "rechnung",
    titel: `Schlussrechnung ${nr} erstellt`,
    body: `${fmt(preis.gesamt)} brutto minus Anzahlung ${fmt(anzahlungBrutto)} = ${fmt(rest)}. Zahlungsziel 14 Tage.`,
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  frisch(vorgangId);
  return { error: null, ok: `Schlussrechnung ${nr} über ${fmt(rest)} erstellt.` };
}

/* ---------------------------------------------- ANZAHLUNGSRECHNUNG */

/**
 * Anzahlungsrechnung nachträglich erstellen.
 *
 * Normalerweise entsteht sie bei der Auftragsauslösung (lib/vorgang/
 * kaskade.ts). Diesen Weg braucht es für zwei Fälle, die es ohne ihn
 * nicht aus der Software heraus gab:
 *
 *   1. Die Anzahlungsrechnung wurde storniert. Die Kaskade läuft nur
 *      einmal — sie prüft auf eine vorhandene Auftragsbestätigung und
 *      würde beim zweiten Durchgang Positionen, Gates und Bedarfsliste
 *      noch einmal anlegen. Ohne diesen Knopf hätte das Storno eine
 *      Sackgasse erzeugt.
 *   2. Der Anzahlungssatz stand bei der Auslösung auf 0 und wurde
 *      später gesetzt.
 *
 * Gerechnet wird aus der eingefrorenen Fassung, genau wie bei der
 * Schlussrechnung — nicht aus dem lebenden Entwurf.
 */
export async function anzahlungsrechnungErstellen(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = schlussSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const { vorgangId } = parsed.data;

  const supabase = await createClient();

  const { data: v } = await supabase
    .from("vorgang")
    .select("id, number, phase, anzahlung_prozent")
    .eq("id", vorgangId)
    .maybeSingle();

  if (!v) return { error: "Vorgang nicht gefunden.", ok: null };

  const prozent = Number(v.anzahlung_prozent ?? 0);
  if (prozent <= 0) {
    return {
      error: "Für diesen Vorgang ist kein Anzahlungssatz hinterlegt.",
      ok: null,
    };
  }

  const { data: vorhanden } = await supabase
    .from("vorgang_dokument")
    .select("nummer")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "anzahlungsrechnung")
    .neq("status", "storniert")
    .order("created_at", { ascending: false })
    .limit(1);

  const aktiv = (vorhanden ?? [])[0];
  if (aktiv) {
    return {
      error: null,
      ok: `Anzahlungsrechnung ${aktiv.nummer as string} besteht bereits.`,
    };
  }

  /* Die eingefrorene Fassung ist der Auftrag. */
  const { data: ab } = await supabase
    .from("vorgang_dokument")
    .select("id")
    .eq("vorgang_id", vorgangId)
    .eq("typ", "ab")
    .maybeSingle();

  if (!ab) {
    return { error: "Ohne Auftragsbestätigung gibt es keinen Auftragswert.", ok: null };
  }

  const [{ data: posRoh }, { data: gruppenRoh }] = await Promise.all([
    supabase
      .from("vorgang_position")
      .select(
        "id, gruppe_id, menge, ep_netto, rabatt_prozent, optional, kunden_auswahl, kalk_ek",
      )
      .eq("dokument_id", ab.id),
    supabase.from("vorgang_gruppe").select("id, paket_preis").eq("dokument_id", ab.id),
  ]);

  const rahmen = await rahmenLaden(supabase, vorgangId);
  const preis = belegPreis(
    (posRoh ?? []) as unknown as Parameters<typeof belegPreis>[0],
    (gruppenRoh ?? []) as unknown as Parameters<typeof belegPreis>[1],
    rahmen,
  );

  const { anzahlungBrutto } = anzahlung(preis.gesamt, prozent);
  if (anzahlungBrutto <= 0) {
    return { error: "Die Anzahlung ergibt keinen Betrag.", ok: null };
  }

  const { data: nr } = await supabase.rpc("next_number", {
    p_company: z1.me.companyId,
    p_kind: "invoice",
  });
  if (typeof nr !== "string") {
    return { error: "Nummer konnte nicht vergeben werden.", ok: null };
  }

  const faellig = new Date();
  faellig.setDate(faellig.getDate() + 14);

  const { data: dok, error } = await supabase
    .from("vorgang_dokument")
    .insert({
      company_id: z1.me.companyId,
      vorgang_id: vorgangId,
      typ: "anzahlungsrechnung",
      kunde_sichtbar: true,
      nummer: nr,
      dateiname: `Anzahlungsrechnung ${nr}.pdf`,
      betrag_netto: nettoAus(anzahlungBrutto, rahmen.ustSatz),
      betrag_brutto: anzahlungBrutto,
      /* Entwurf, nicht versendet: der Versand ist eine eigene Entscheidung. */
      status: "entwurf",
      faellig_am: faellig.toISOString().slice(0, 10),
      created_by: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !dok) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message}`, ok: null };
  }

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: vorgangId,
    typ: "rechnung",
    titel: `Anzahlungsrechnung ${nr} erstellt`,
    body: `${prozent} % von ${fmt(preis.gesamt)} = ${fmt(anzahlungBrutto)}. Zahlungsziel 14 Tage.`,
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  frisch(vorgangId);
  return { error: null, ok: `Anzahlungsrechnung ${nr} über ${fmt(anzahlungBrutto)} erstellt.` };
}

/* -------------------------------------------------------- VERSENDEN */

const versandSchema = z.object({
  vorgangId: z.string().uuid(),
  dokumentId: z.string().uuid(),
});

export async function rechnungVersenden(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = versandSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: dok } = await supabase
    .from("vorgang_dokument")
    .select("id, typ, nummer, status, betrag_brutto")
    .eq("id", d.dokumentId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!dok) return { error: "Dokument nicht gefunden.", ok: null };
  if (dok.status !== "entwurf") {
    return { error: `Der Beleg ist bereits ${dok.status as string}.`, ok: null };
  }

  const { error } = await supabase
    .from("vorgang_dokument")
    .update({ status: "versendet" })
    .eq("id", d.dokumentId);

  if (error) return { error: `Versand fehlgeschlagen: ${error.message}`, ok: null };

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    typ: "rechnung",
    titel: `${dok.nummer as string} versendet`,
    body: `${fmt(Number(dok.betrag_brutto ?? 0))} brutto an den Kunden.`,
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  frisch(d.vorgangId);
  return { error: null, ok: "Als versendet vermerkt." };
}

/* ---------------------------------------------------------- ZAHLUNG */

const zahlungSchema = z.object({
  vorgangId: z.string().uuid(),
  dokumentId: z.string().uuid(),
  bezahltAm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum fehlt."),
  betrag: z.coerce.number().min(0).optional(),
});

/**
 * Zahlung erfassen — ganz oder in Teilen.
 *
 * Der Teilbetrag wird addiert und in `bezahlt_betrag` festgehalten
 * (Migration 0073). Vorher stand er nur im Ereignistext: der Beleg blieb
 * mit dem vollen Betrag in der Postenliste stehen, und die
 * Zahlungserinnerung forderte die ganze Summe noch einmal — bei einem
 * Kunden, der schon gezahlt hatte.
 *
 * Gerechnet wird in `lib/vorgang/zahlung.ts`, damit Postenliste,
 * Mahnlauf, Cockpit und Umsatzbericht denselben Restbetrag sehen.
 */
export async function zahlungErfassen(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = zahlungSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: dok } = await supabase
    .from("vorgang_dokument")
    .select("id, nummer, status, betrag_brutto, bezahlt_betrag")
    .eq("id", d.dokumentId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!dok) return { error: "Beleg nicht gefunden.", ok: null };
  if (dok.status === "bezahlt") {
    return { error: null, ok: "Der Beleg ist bereits als bezahlt vermerkt." };
  }
  if (dok.status === "storniert") {
    return {
      error: "Auf eine stornierte Rechnung wird nichts gebucht.",
      ok: null,
    };
  }

  const soll = Number(dok.betrag_brutto ?? 0);
  const bisher = Number(dok.bezahlt_betrag ?? 0);
  /* Ohne Eingabe gilt der offene Rest, nicht der Gesamtbetrag. */
  const betrag = d.betrag ?? restbetrag(soll, bisher);

  const buchung = zahlungBuchen({ soll, bisher, betrag });
  if (!buchung.ok) {
    return {
      error:
        buchung.fehler === "ueberzahlung"
          ? `${ZAHLUNG_FEHLER.ueberzahlung} Offen sind ${fmt(buchung.offen)}.`
          : ZAHLUNG_FEHLER[buchung.fehler],
      ok: null,
    };
  }

  const { error } = await supabase
    .from("vorgang_dokument")
    .update({
      bezahlt_betrag: buchung.bezahlt,
      status: buchung.vollstaendig ? "bezahlt" : "versendet",
      /*
       * Das Zahldatum gehört der vollständigen Zahlung. Bei einer
       * Teilzahlung bleibt es leer — sonst gilt der Beleg in jeder
       * Auswertung, die auf `bezahlt_am` schaut, als erledigt.
       */
      bezahlt_am: buchung.vollstaendig ? d.bezahltAm : null,
    })
    .eq("id", d.dokumentId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    typ: "zahlung",
    titel: buchung.vollstaendig
      ? `Zahlung erfasst — ${dok.nummer as string}`
      : `Teilzahlung erfasst — ${dok.nummer as string}`,
    body: buchung.vollstaendig
      ? `${fmt(betrag)} am ${d.bezahltAm}. Damit sind ${fmt(buchung.bezahlt)} von ${fmt(soll)} bezahlt.`
      : `${fmt(betrag)} am ${d.bezahltAm}. Bezahlt ${fmt(buchung.bezahlt)} von ${fmt(soll)}, offen bleiben ${fmt(buchung.rest)}.`,
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  frisch(d.vorgangId);
  return {
    error: null,
    ok: buchung.vollstaendig
      ? "Zahlung erfasst."
      : `Teilzahlung vermerkt. Offen bleiben ${fmt(buchung.rest)}.`,
  };
}

/* ----------------------------------------------------------- STORNO */

const stornoSchema = z.object({
  vorgangId: z.string().uuid(),
  dokumentId: z.string().uuid(),
  grund: z.string().min(1, "Ein Storno braucht einen Grund."),
});

/**
 * Eine Rechnung stornieren.
 *
 * ENTSCHEIDUNG: Der Status genügt, es entsteht KEINE Stornorechnung als
 * eigener Beleg mit eigener Nummer und negativem Betrag.
 *
 * Dagegen sprach nicht der Aufwand, sondern die Doppelzählung. Jede
 * Auswertung in diesem Produkt schliesst Storniertes heute über den
 * STATUS aus: die Postenliste, der Umsatzbericht (`lib/reports.ts`), der
 * Buchhaltungsexport und der Mahnlauf (`lib/rules/dunning.ts`). Käme ein
 * negativer Beleg hinzu, fiele die Rechnung dort einmal durch den
 * Statusfilter heraus UND einmal als negative Zeile hinein — der Umsatz
 * eines Monats ginge um den Rechnungsbetrag ins Minus statt auf null.
 * Das richtig zu bekommen hiesse, jeden dieser Filter umzudrehen und die
 * Paarbildung überall nachzubauen; der Gewinn wäre eine Belegnummer.
 *
 * Nachvollziehbar ist das Storno trotzdem: die Zeile bleibt mit Nummer,
 * Beträgen, Zeitpunkt und Grund stehen (0073), `audit_log` hält die
 * Änderung append-only (Trigger aus 0025), und im Ereignisstrom steht
 * der Grund im Klartext. Gelöscht wird nichts — Rechnungen sind
 * aufzubewahren.
 *
 * Was dieser Weg NICHT leistet: eine Rechnung, die schon im nächtlichen
 * Buchhaltungsexport war, braucht beim Steuerberater eine Gegenbuchung.
 * Die erzeugt `/api/cron/accounting-export` mit — dort steht, wie.
 */
export async function rechnungStornieren(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = stornoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: dok } = await supabase
    .from("vorgang_dokument")
    .select("id, typ, nummer, status, betrag_brutto, bezahlt_betrag")
    .eq("id", d.dokumentId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!dok) return { error: "Beleg nicht gefunden.", ok: null };

  const pruefung = stornoPruefen({
    typ: dok.typ as string,
    status: dok.status as string | null,
    grund: d.grund,
  });
  if (!pruefung.ok) {
    return { error: STORNO_FEHLER[pruefung.fehler], ok: null };
  }

  const grund = d.grund.trim();
  const bezahlt = Number(dok.bezahlt_betrag ?? 0);

  const { error } = await supabase
    .from("vorgang_dokument")
    .update({
      status: "storniert",
      storniert_am: new Date().toISOString(),
      storno_grund: grund,
      /*
       * Der Mahnlauf greift über den Status ohnehin nicht mehr; der
       * Schalter wird zusätzlich gelegt, damit ein späteres
       * Wiederöffnen nicht aus Versehen eine Mahnung auslöst.
       */
      mahnung_aktiv: false,
    })
    .eq("id", d.dokumentId);

  if (error) return { error: `Storno fehlgeschlagen: ${error.message}`, ok: null };

  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    typ: "rechnung",
    titel: `${dok.nummer as string} storniert`,
    body:
      `${fmt(Number(dok.betrag_brutto ?? 0))} brutto. Grund: ${grund}` +
      (bezahlt > 0
        ? ` Achtung: ${fmt(bezahlt)} sind bereits eingegangen und müssen zurückgezahlt werden — das bucht die Software nicht.`
        : ""),
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  frisch(d.vorgangId);
  return {
    error: null,
    ok:
      bezahlt > 0
        ? `${dok.nummer as string} storniert. ${fmt(bezahlt)} sind bereits eingegangen — Rückzahlung klären.`
        : `${dok.nummer as string} storniert. Eine neue Rechnung lässt sich jetzt erstellen.`,
  };
}

/**
 * Einen Rechnungsentwurf verwerfen.
 *
 * Das Gegenstück zum Storno und bisher der fehlende Weg: ein Entwurf hat
 * den Betrieb nie verlassen, es gibt nichts zu stornieren und nichts
 * aufzubewahren. Stehen bleiben darf er aber auch nicht — sonst blockiert
 * eine falsch erzeugte Schlussrechnung die richtige, und die Postenliste
 * fordert einen Betrag, den niemand bekommen hat.
 *
 * Nur Rechnungsentwürfe, nichts anderes: Angebotsfassungen und die
 * Auftragsbestätigung sind die eingefrorene Grundlage ihrer Positionen
 * (0050), die hängen an einem Löschen mit dran. Die vergebene
 * Rechnungsnummer verfällt — Lücken sind erlaubt, Duplikate nicht
 * (CLAUDE.md 5.6).
 */
export async function rechnungEntwurfVerwerfen(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = versandSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: dok } = await supabase
    .from("vorgang_dokument")
    .select("id, typ, nummer, status")
    .eq("id", d.dokumentId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!dok) return { error: "Beleg nicht gefunden.", ok: null };
  if (!STORNIERBAR.includes(dok.typ as string)) {
    return { error: "Verworfen wird nur ein Rechnungsentwurf.", ok: null };
  }
  if (dok.status !== "entwurf") {
    return {
      error: `Der Beleg ist ${dok.status as string} — verworfen wird nur ein Entwurf. Versendetes wird storniert.`,
      ok: null,
    };
  }

  const nummer = (dok.nummer as string | null) ?? "ohne Nummer";

  /*
   * Erst das Ereignis, dann die Zeile: der Fremdschlüssel von
   * vorgang_event.dokument_id steht auf `on delete set null` (0025), das
   * Ereignis überlebt also das Dokument. Andersherum wäre die Spur weg,
   * wenn das Löschen gelingt und das Schreiben scheitert.
   */
  await supabase.from("vorgang_event").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    typ: "rechnung",
    titel: `Rechnungsentwurf ${nummer} verworfen`,
    body: "Der Entwurf war nicht versendet. Die Nummer verfällt.",
    dokument_id: dok.id,
    created_by: z1.me.id,
  });

  const { error } = await supabase
    .from("vorgang_dokument")
    .delete()
    .eq("id", d.dokumentId);

  if (error) return { error: `Verwerfen fehlgeschlagen: ${error.message}`, ok: null };

  frisch(d.vorgangId);
  return { error: null, ok: `Entwurf ${nummer} verworfen.` };
}

/* ----------------------------------------------------- ABSCHLIESSEN */

/**
 * Vorgang abschliessen.
 *
 * Nur wenn nichts mehr offen ist. Ein abgeschlossener Vorgang mit
 * unbezahlter Rechnung verschwindet aus dem Blick und fällt erst beim
 * Jahresabschluss auf.
 */
export async function vorgangAbschliessen(
  _prev: RechnungStatus,
  formData: FormData,
): Promise<RechnungStatus> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return { error: "Keine Berechtigung.", ok: null };
  }

  const parsed = schlussSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const { vorgangId } = parsed.data;

  const supabase = await createClient();

  /*
   * Eine stornierte Rechnung ist erledigt, nicht offen. Ohne den Filter
   * blockierte sie den Abschluss für immer: bezahlt wird sie nie, und
   * löschen darf man sie nicht.
   */
  const { data: offen } = await supabase
    .from("vorgang_dokument")
    .select("nummer, status")
    .eq("vorgang_id", vorgangId)
    .in("typ", ["anzahlungsrechnung", "schlussrechnung"])
    .neq("status", "bezahlt")
    .neq("status", "storniert");

  if ((offen ?? []).length > 0) {
    return {
      error: `Noch offen: ${(offen ?? [])
        .map((o) => o.nummer as string)
        .join(", ")}. Zuerst die Zahlung erfassen.`,
      ok: null,
    };
  }

  const { data: gates } = await supabase
    .from("vorgang_gate")
    .select("label, status")
    .eq("vorgang_id", vorgangId)
    .not("status", "in", "(erledigt,nicht_noetig)");

  await supabase.from("vorgang_event").insert({
    company_id: me.companyId,
    vorgang_id: vorgangId,
    typ: "phase_wechsel",
    titel: "Vorgang abgeschlossen",
    body:
      (gates ?? []).length > 0
        ? `Keine offenen Rechnungen. Noch offene Gates: ${(gates ?? [])
            .map((g) => g.label as string)
            .join(", ")}.`
        : "Keine offenen Gates, keine offenen Rechnungen.",
    created_by: me.id,
  });

  await supabase
    .from("vorgang")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", vorgangId);

  frisch(vorgangId);
  return { error: null, ok: "Vorgang abgeschlossen." };
}

function fmt(n: number): string {
  return `${n.toLocaleString("de-AT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}
