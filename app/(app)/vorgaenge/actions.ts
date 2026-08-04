"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  PHASE_LABEL,
  VERLOREN_GRUND_LABEL,
  darfTerminieren,
  gateDurch,
  naechsterGateStatus,
  offenePflichtGates,
  wechselErlaubt,
  type Gate,
  type GateStatus,
  type Phase,
} from "@/lib/vorgang/modell";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type VorgangStatus = { error: string | null; ok: string | null };

/**
 * Alles, was an einem Vorgang geschieht.
 *
 * Jede Zustandsänderung schreibt einen Eintrag in den Aktivitätsstrom.
 * Das ist keine Zugabe: der Strom IST die Historie des Vorgangs, und ein
 * Phasenwechsel ohne Spur ist genau die Frage, die im Betrieb drei Wochen
 * später niemand mehr beantworten kann.
 */

type Zugang =
  | { ok: true; me: Awaited<ReturnType<typeof requireMe>> }
  | { ok: false; status: VorgangStatus };

async function schreibzugang(): Promise<Zugang> {
  const me = await requireMe();
  if (me.perms.pipelines !== "write") {
    return {
      ok: false,
      status: { error: "Für Vorgänge fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  if (me.company.status !== "active") {
    return { ok: false, status: { error: "Der Zugang ist derzeit nur lesend.", ok: null } };
  }
  return { ok: true, me };
}

type EventEingabe = {
  typ: string;
  titel: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  dokumentId?: string | null;
};

async function ereignis(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  vorgangId: string,
  userId: string,
  e: EventEingabe,
): Promise<void> {
  await supabase.from("vorgang_event").insert({
    company_id: companyId,
    vorgang_id: vorgangId,
    typ: e.typ,
    titel: e.titel,
    body: e.body ?? null,
    payload: e.payload ?? {},
    dokument_id: e.dokumentId ?? null,
    created_by: userId,
  });
}

function frisch(id: string): void {
  revalidatePath(`/vorgaenge/${id}`);
  revalidatePath("/vorgaenge");
  revalidatePath("/cockpit");
}

/* ------------------------------------------------------------- ANLEGEN */

const anlegenSchema = z.object({
  /*
   * Entweder ein bestehender Kunde oder ein neuer Name. Mit dem CRM ist
   * die Stelle weggefallen, an der man einen Kunden anlegen konnte — und
   * eine Anfrage kommt nun einmal von jemandem, den es noch nicht gibt.
   */
  customerId: z.string().uuid().optional().or(z.literal("")),
  kundeName: z.string().trim().max(120).optional().default(""),
  kundeKontakt: z.string().trim().max(120).optional().default(""),
  kundeEmail: z
    .string()
    .trim()
    .max(160)
    .optional()
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Das ist keine gültige Mailadresse.",
    }),
  kundeTelefon: z.string().trim().max(60).optional().default(""),
  kwp: z.coerce.number().min(0).max(10000).optional(),
  speicherKwh: z.coerce.number().min(0).max(10000).optional(),
  adresse: z.string().trim().max(200).optional().default(""),
  plz: z.string().trim().max(10).optional().default(""),
  ort: z.string().trim().max(80).optional().default(""),
  notiz: z.string().trim().max(2000).optional().default(""),
});

export async function vorgangAnlegen(
  _prev: VorgangStatus,
  formData: FormData,
): Promise<VorgangStatus> {
  const z1 = await schreibzugang();
  if (!z1.ok) return z1.status;

  const parsed = anlegenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  if (!d.customerId && d.kundeName.length < 2) {
    return {
      error: "Bitte einen Kunden wählen oder einen Namen eintragen.",
      ok: null,
    };
  }

  const supabase = await createClient();

  /*
   * Neuer Kunde als Lead. Erst wenn ein Vorgang beauftragt wird, ist er
   * ein Bestandskunde — den Wechsel macht niemand von Hand, sondern die
   * Annahme.
   */
  let customerId = d.customerId || "";
  if (!customerId) {
    if (z1.me.perms.crm !== "write") {
      return {
        error: "Für neue Kunden fehlt deiner Rolle das Schreibrecht.",
        ok: null,
      };
    }
    const { data: neu, error: kFehler } = await supabase
      .from("customer")
      .insert({
        company_id: z1.me.companyId,
        name: d.kundeName,
        type: "lead",
        contact_person: d.kundeKontakt || null,
        email: d.kundeEmail || null,
        phone: d.kundeTelefon || null,
        address: d.adresse || null,
        zip: d.plz || null,
        city: d.ort || null,
      })
      .select("id")
      .single();

    if (kFehler || !neu) {
      return { error: `Kunde anlegen fehlgeschlagen: ${kFehler?.message}`, ok: null };
    }
    customerId = neu.id as string;
  }

  const { data: nummer, error: nrFehler } = await supabase.rpc("next_number", {
    p_company: z1.me.companyId,
    p_kind: "vorgang",
  });
  if (nrFehler || typeof nummer !== "string") {
    return { error: "Nummer konnte nicht vergeben werden.", ok: null };
  }

  /*
   * Adresse und Anlagendaten kommen aus dem Kunden, wenn sie hier nicht
   * eingetragen sind. Der Vorgang trägt sie danach selbst — eine spätere
   * Adressänderung beim Kunden verschiebt keine Baustelle, die schon
   * terminiert ist.
   */
  const { data: kunde } = await supabase
    .from("customer")
    .select("address, zip, city")
    .eq("id", customerId)
    .maybeSingle();

  const { data: vorgang, error } = await supabase
    .from("vorgang")
    .insert({
      company_id: z1.me.companyId,
      customer_id: customerId,
      number: nummer,
      phase: "anfrage",
      kwp: d.kwp && d.kwp > 0 ? d.kwp : null,
      speicher_kwh: d.speicherKwh && d.speicherKwh > 0 ? d.speicherKwh : null,
      adresse: d.adresse || (kunde?.address as string | null) || null,
      plz: d.plz || (kunde?.zip as string | null) || null,
      ort: d.ort || (kunde?.city as string | null) || null,
      zustaendig_user_id: z1.me.id,
      created_by: z1.me.id,
    })
    .select("id, number")
    .single();

  if (error || !vorgang) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message ?? "unbekannt"}`, ok: null };
  }

  await ereignis(supabase, z1.me.companyId, vorgang.id as string, z1.me.id, {
    typ: "notiz",
    titel: "Vorgang angelegt",
    body: d.notiz || null,
  });

  revalidatePath("/vorgaenge");
  return { error: null, ok: `${vorgang.number as string} angelegt.` };
}

/* -------------------------------------------------------- PHASENWECHSEL */

const phasenSchema = z.object({
  vorgangId: z.string().uuid(),
  nach: z.enum([
    "anfrage",
    "aufnahme",
    "angebot",
    "beauftragt",
    "montage",
    "abschluss",
  ]),
  notiz: z.string().trim().max(500).optional().default(""),
});

/**
 * Phase weiterschalten oder korrigieren.
 *
 * Kein freies Setzen: erlaubt ist genau ein Schritt vorwärts oder ein
 * Rückschritt zur Korrektur — geprüft in lib/vorgang/modell.ts. Der
 * Rückschritt wird als solcher protokolliert, damit im Strom steht, dass
 * jemand zurückgegangen ist und nicht, dass die Phase nie erreicht war.
 */
export async function phaseWechseln(
  _prev: VorgangStatus,
  formData: FormData,
): Promise<VorgangStatus> {
  const z1 = await schreibzugang();
  if (!z1.ok) return z1.status;

  const parsed = phasenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: v } = await supabase
    .from("vorgang")
    .select("id, number, phase")
    .eq("id", d.vorgangId)
    .maybeSingle();

  if (!v) return { error: "Vorgang nicht gefunden.", ok: null };

  const von = v.phase as Phase;
  if (!wechselErlaubt(von, d.nach)) {
    return {
      error: `Aus „${PHASE_LABEL[von]}" ist „${PHASE_LABEL[d.nach]}" kein erlaubter Schritt.`,
      ok: null,
    };
  }

  /*
   * Der Sprung in die Montage hängt an den Pflicht-Gates. Die Prüfung
   * steht hier und nicht nur im Knopf: ein deaktivierter Knopf ist keine
   * Absicherung, er ist eine Anzeige.
   */
  if (d.nach === "montage") {
    const gates = await gatesLesen(supabase, d.vorgangId);
    const offen = offenePflichtGates(gates);
    if (offen.length > 0) {
      return {
        error: `Terminierung blockiert. Offene Pflicht-Gates: ${offen
          .map((g) => g.label)
          .join(", ")}.`,
        ok: null,
      };
    }
  }

  /* d.nach kann nie "verloren" sein — dafür gibt es vorgangVerloren(). */
  const rueckschritt = istRueckschritt(von, d.nach);

  const { error } = await supabase
    .from("vorgang")
    .update({
      phase: d.nach,
      phase_seit: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", d.vorgangId);

  if (error) return { error: `Wechsel fehlgeschlagen: ${error.message}`, ok: null };

  await ereignis(supabase, z1.me.companyId, d.vorgangId, z1.me.id, {
    typ: "phase_wechsel",
    titel: rueckschritt
      ? `Phase korrigiert auf „${PHASE_LABEL[d.nach]}"`
      : `Phase → ${PHASE_LABEL[d.nach]}`,
    body:
      d.notiz ||
      (rueckschritt
        ? `Rückschritt aus „${PHASE_LABEL[von]}" durch ${z1.me.name}.`
        : null),
    payload: { von, nach: d.nach },
  });

  frisch(d.vorgangId);
  return { error: null, ok: `Phase: ${PHASE_LABEL[d.nach]}.` };
}

function istRueckschritt(von: Phase, nach: Phase): boolean {
  const reihe: Phase[] = [
    "anfrage",
    "aufnahme",
    "angebot",
    "beauftragt",
    "montage",
    "abschluss",
  ];
  return reihe.indexOf(nach) < reihe.indexOf(von);
}

/* ------------------------------------------------------------ VERLOREN */

const verlorenSchema = z.object({
  vorgangId: z.string().uuid(),
  grund: z.enum([
    "preis",
    "konkurrenz",
    "keine_rueckmeldung",
    "nicht_machbar",
    "kunde_verschoben",
    "sonstiges",
  ]),
  notiz: z.string().trim().max(1000).optional().default(""),
});

/**
 * Vorgang verloren geben.
 *
 * Der Grund ist Pflicht — die Datenbank erzwingt ihn zusätzlich. Ein
 * Betrieb, der nach einem Jahr wissen will, warum er verliert, hat sonst
 * eine Spalte voller NULL und keine Antwort.
 */
export async function vorgangVerloren(
  _prev: VorgangStatus,
  formData: FormData,
): Promise<VorgangStatus> {
  const z1 = await schreibzugang();
  if (!z1.ok) return z1.status;

  const parsed = verlorenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Grund fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: v } = await supabase
    .from("vorgang")
    .select("phase, number")
    .eq("id", d.vorgangId)
    .maybeSingle();

  if (!v) return { error: "Vorgang nicht gefunden.", ok: null };
  if (!wechselErlaubt(v.phase as Phase, "verloren")) {
    return {
      error: "Ein abgeschlossener Vorgang lässt sich nicht verloren geben.",
      ok: null,
    };
  }

  const { error } = await supabase
    .from("vorgang")
    .update({
      phase: "verloren",
      verloren_grund: d.grund,
      verloren_notiz: d.notiz || null,
      verloren_am: new Date().toISOString(),
      phase_seit: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", d.vorgangId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await ereignis(supabase, z1.me.companyId, d.vorgangId, z1.me.id, {
    typ: "phase_wechsel",
    titel: `Verloren — ${VERLOREN_GRUND_LABEL[d.grund]}`,
    body: d.notiz || null,
    payload: { grund: d.grund },
  });

  frisch(d.vorgangId);
  return {
    error: null,
    ok: `${v.number as string} als verloren vermerkt. Im Verloren-Filter weiter auswertbar.`,
  };
}

/** Einen verlorenen Vorgang zurückholen. */
export async function vorgangReaktivieren(
  _prev: VorgangStatus,
  formData: FormData,
): Promise<VorgangStatus> {
  const z1 = await schreibzugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("vorgangId"));
  if (!id.success) return { error: "Vorgang fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("vorgang")
    .update({
      phase: "angebot",
      /*
       * Grund und Notiz bleiben stehen. Sie sind die Geschichte des
       * Vorgangs — wer sie beim Reaktivieren löscht, verliert genau die
       * Auswertung, für die sie erhoben wurden.
       */
      verloren_am: null,
      phase_seit: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id.data)
    .eq("phase", "verloren");

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await ereignis(supabase, z1.me.companyId, id.data, z1.me.id, {
    typ: "phase_wechsel",
    titel: "Vorgang reaktiviert",
    body: "Zurück in Phase Angebot. Der Verlustgrund bleibt für die Auswertung erhalten.",
  });

  frisch(id.data);
  return { error: null, ok: "Wieder aufgenommen." };
}

/* --------------------------------------------------------------- GATES */

const gateSchema = z.object({
  vorgangId: z.string().uuid(),
  gateId: z.string().uuid(),
  status: z.enum(["offen", "laeuft", "erledigt", "nicht_noetig"]).optional(),
});

/**
 * Gate weiterschalten.
 *
 * Ohne Zielstatus klickt es durch den Zyklus — das ist der schnelle Weg
 * in der Ampelleiste. Mit Zielstatus setzt es direkt, für die Auswahl im
 * Aktionspanel.
 */
export async function gateSetzen(
  _prev: VorgangStatus,
  formData: FormData,
): Promise<VorgangStatus> {
  const me = await requireMe();
  if (me.company.status !== "active") {
    return { error: "Der Zugang ist derzeit nur lesend.", ok: null };
  }

  const parsed = gateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: g } = await supabase
    .from("vorgang_gate")
    .select("id, key, label, status, blocking")
    .eq("id", d.gateId)
    .eq("vorgang_id", d.vorgangId)
    .maybeSingle();

  if (!g) return { error: "Gate nicht gefunden.", ok: null };

  /*
   * Wer Vorgänge schreiben darf, setzt jedes Gate. Das Lager darf genau
   * eines: sein eigenes. Es arbeitet die Materialliste ab und hakt dort
   * ab — ohne dieses Recht wäre die Lageransicht Dekoration, und jemand
   * im Büro müsste hinterherklicken, was das Lager längst erledigt hat
   * (Briefing Abschnitt 6).
   */
  const darf =
    me.perms.pipelines === "write" ||
    (me.perms.lager === "write" && (g.key as string) === "material");

  if (!darf) {
    return {
      error:
        (g.key as string) === "material"
          ? "Für das Material-Gate fehlt deiner Rolle das Schreibrecht auf Lager."
          : "Für Gates fehlt deiner Rolle das Schreibrecht.",
      ok: null,
    };
  }

  const z1 = { me };

  const neu: GateStatus = d.status ?? naechsterGateStatus(g.status as GateStatus);

  const { error } = await supabase
    .from("vorgang_gate")
    .update({
      status: neu,
      erledigt_am: gateDurch({ status: neu }) ? new Date().toISOString() : null,
    })
    .eq("id", d.gateId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await ereignis(supabase, z1.me.companyId, d.vorgangId, z1.me.id, {
    typ: "gate_update",
    titel: `Gate „${g.label as string}" → ${neu}`,
    body: `Geändert von ${z1.me.name}.`,
    payload: { key: g.key, von: g.status, nach: neu },
  });

  /* Wird damit die Terminierung frei? Das ist die Nachricht, auf die im
     Büro gewartet wird — sonst muss jemand die Ampeln nachzählen. */
  const gates = await gatesLesen(supabase, d.vorgangId);
  const frei = darfTerminieren(gates);

  frisch(d.vorgangId);
  return {
    error: null,
    ok: frei
      ? "Gespeichert. Alle Pflicht-Gates sind durch — die Montage lässt sich terminieren."
      : "Gespeichert.",
  };
}

/* -------------------------------------------------------------- NOTIZ */

const notizSchema = z.object({
  vorgangId: z.string().uuid(),
  body: z.string().trim().min(2, "Die Notiz ist leer.").max(4000),
  titel: z.string().trim().max(120).optional().default(""),
});

export async function notizAnlegen(
  _prev: VorgangStatus,
  formData: FormData,
): Promise<VorgangStatus> {
  const z1 = await schreibzugang();
  if (!z1.ok) return z1.status;

  const parsed = notizSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  await ereignis(supabase, z1.me.companyId, d.vorgangId, z1.me.id, {
    typ: "notiz",
    titel: d.titel || "Notiz",
    body: d.body,
  });

  frisch(d.vorgangId);
  return { error: null, ok: "Notiz gespeichert." };
}

/* ---------------------------------------------------------- STAMMDATEN */

const stammSchema = z.object({
  vorgangId: z.string().uuid(),
  kwp: z.coerce.number().min(0).max(10000).optional(),
  speicherKwh: z.coerce.number().min(0).max(10000).optional(),
  adresse: z.string().trim().max(200).optional().default(""),
  plz: z.string().trim().max(10).optional().default(""),
  ort: z.string().trim().max(80).optional().default(""),
  zaehlpunkt: z.string().trim().max(60).optional().default(""),
  zustaendigId: z.string().uuid().or(z.literal("")).optional().default(""),
  anzahlungProzent: z.coerce.number().min(0).max(100).optional(),
  wiedervorlageAm: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .optional()
    .default(""),
});

export async function stammdatenSpeichern(
  _prev: VorgangStatus,
  formData: FormData,
): Promise<VorgangStatus> {
  const z1 = await schreibzugang();
  if (!z1.ok) return z1.status;

  const parsed = stammSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: geschrieben, error } = await supabase
    .from("vorgang")
    .update({
      kwp: d.kwp && d.kwp > 0 ? d.kwp : null,
      speicher_kwh: d.speicherKwh && d.speicherKwh > 0 ? d.speicherKwh : null,
      adresse: d.adresse || null,
      plz: d.plz || null,
      ort: d.ort || null,
      zaehlpunkt: d.zaehlpunkt || null,
      zustaendig_user_id: d.zustaendigId || null,
      ...(d.anzahlungProzent !== undefined
        ? { anzahlung_prozent: d.anzahlungProzent }
        : {}),
      wiedervorlage_am: d.wiedervorlageAm || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", d.vorgangId)
    .select("id");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };
  if (!geschrieben || geschrieben.length === 0) {
    return { error: "Nicht gespeichert — fehlende Berechtigung.", ok: null };
  }

  frisch(d.vorgangId);
  return { error: null, ok: "Gespeichert." };
}

/* ------------------------------------------------------------- HELFER */

async function gatesLesen(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vorgangId: string,
): Promise<Gate[]> {
  const { data } = await supabase
    .from("vorgang_gate")
    .select("key, label, status, blocking")
    .eq("vorgang_id", vorgangId);

  return ((data ?? []) as unknown as {
    key: string;
    label: string;
    status: GateStatus;
    blocking: boolean;
  }[]).map((g) => ({
    key: g.key,
    label: g.label,
    status: g.status,
    blocking: g.blocking,
  }));
}
