"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import {
  entnahmeBuchen,
  inventurBuchen,
  rueckgabeBuchen,
  umbuchen,
} from "@/lib/material/buchen";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Die Bewegungen aus der Beladeliste, der Lageransicht und der
 * Monteur-App.
 *
 * Wer hakt, bucht — es gibt keinen zweiten Buchungsschritt für
 * irgendwen. Ob das Lager vorkommissioniert oder der Monteur selbst
 * lädt, ist Betriebsorganisation und keine Softwareentscheidung; beide
 * Wege erzeugen dieselbe Bewegung.
 */

async function zugang() {
  const me = await requireMe();
  /*
   * Der Monteur darf buchen. Ohne dieses Recht müsste jemand im Büro
   * nachtragen, was auf der Baustelle längst passiert ist — und genau
   * daran scheitern Lagersysteme im Handwerk.
   */
  const darf =
    me.perms.lager === "write" ||
    me.perms.pipelines === "write" ||
    me.perms.zeiterfassung === "write";

  if (!darf) {
    return {
      ok: false as const,
      status: { error: "Für Materialbuchungen fehlt deiner Rolle das Recht.", ok: null },
    };
  }
  return { ok: true as const, me };
}

function frisch(vorgangId?: string) {
  revalidatePath("/material");
  revalidatePath("/m/beladen");
  if (vorgangId) revalidatePath(`/vorgaenge/${vorgangId}`);
}

/** Der Haken auf der Beladeliste — Entnahme auf den Vorgang. */
export async function ladenAbhaken(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      vorgangId: z.string().uuid(),
      artikelId: z.string().uuid(),
      menge: z.coerce.number().gt(0, "Menge muss größer als null sein."),
      bedarfId: z.string().uuid().optional().or(z.literal("")),
      /** Gesetzt, wenn das Lager vorkommissioniert. */
      bereitstellen: z.enum(["ja", "nein"]).optional().default("nein"),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const supabase = await createClient();

  const ergebnis = await entnahmeBuchen(supabase, {
    companyId: z1.me.companyId,
    userId: z1.me.id,
    vorgangId: d.vorgangId,
    artikelId: d.artikelId,
    menge: d.menge,
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  /*
   * Beim Kommissionieren wird zusätzlich vermerkt, dass die Ware
   * bereitsteht. Der Monteur sieht sie dann als „bereitgestellt" und
   * bestätigt nur die Übernahme — das erzeugt KEINE zweite Buchung.
   */
  if (d.bereitstellen === "ja" && d.bedarfId) {
    await supabase
      .from("vorgang_bedarf")
      .update({ bereitgestellt_am: new Date().toISOString() })
      .eq("id", d.bedarfId);
  }

  frisch(d.vorgangId);
  return { error: null, ok: ergebnis.hinweis ?? "Gebucht." };
}

/**
 * Übernahme bestätigen.
 *
 * Nur ein Protokoll, keine Buchung: gebucht hat, wer kommissioniert hat.
 * Zwei Buchungen für dieselbe Palette wären zwei Abgänge.
 */
export async function uebernahmeBestaetigen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ bedarfId: z.string().uuid(), vorgangId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("vorgang_bedarf")
    .update({ uebernommen_am: new Date().toISOString() })
    .eq("id", parsed.data.bedarfId);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  frisch(parsed.data.vorgangId);
  return { error: null, ok: "Übernahme vermerkt." };
}

/** Rückläufer am Tagesende — zurück ins Lager, entlastet den Vorgang. */
export async function rueckgabeErfassen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      vorgangId: z.string().uuid(),
      artikelId: z.string().uuid(),
      menge: z.coerce.number().gt(0, "Menge muss größer als null sein."),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const supabase = await createClient();

  const ergebnis = await rueckgabeBuchen(supabase, {
    companyId: z1.me.companyId,
    userId: z1.me.id,
    vorgangId: d.vorgangId,
    artikelId: d.artikelId,
    menge: d.menge,
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  frisch(d.vorgangId);
  return { error: null, ok: "Zurückgebucht." };
}

/** Nachschub aufs Fahrzeug — kostenneutral, kein Vorgang. */
export async function umbuchenAufFahrzeug(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      artikelId: z.string().uuid(),
      menge: z.coerce.number().gt(0, "Menge muss größer als null sein."),
      vonLagerortId: z.string().uuid(),
      nachLagerortId: z.string().uuid(),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const ergebnis = await umbuchen(supabase, {
    companyId: z1.me.companyId,
    userId: z1.me.id,
    ...parsed.data,
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  frisch();
  return { error: null, ok: "Umgebucht." };
}

/**
 * Verbrauchsmeldung nach dem Einsatz.
 *
 * Van-Stock wird nicht beim Laden gebucht, sondern beim Verbrauchen —
 * alles andere wäre geraten. Die Mengen kommen als Feldpaare
 * menge:<artikelId>; leer heisst nichts verbraucht.
 */
export async function verbrauchMelden(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const vorgangId = z.string().uuid().safeParse(formData.get("vorgangId"));
  if (!vorgangId.success) return { error: "Vorgang fehlt.", ok: null };

  const lagerortId = z.string().uuid().safeParse(formData.get("lagerortId"));
  if (!lagerortId.success) return { error: "Fahrzeug fehlt.", ok: null };

  const einsatzId = z.string().uuid().safeParse(formData.get("einsatzId"));

  const supabase = await createClient();
  let gebucht = 0;

  for (const [key, wert] of formData.entries()) {
    if (!key.startsWith("menge:")) continue;
    const artikelId = key.slice("menge:".length);
    const menge = Number(String(wert).replace(",", "."));
    if (!Number.isFinite(menge) || menge <= 0) continue;

    const ergebnis = await entnahmeBuchen(supabase, {
      companyId: z1.me.companyId,
      userId: z1.me.id,
      vorgangId: vorgangId.data,
      artikelId,
      menge,
      vonLagerortId: lagerortId.data,
      einsatzId: einsatzId.success ? einsatzId.data : null,
      notiz: "Verbrauchsmeldung",
    });

    if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };
    gebucht++;
  }

  frisch(vorgangId.data);
  return {
    error: null,
    ok: gebucht === 0 ? "Kein Verbrauch gemeldet." : `${gebucht} Meldungen gebucht.`,
  };
}

/**
 * Inventur eines Lagerorts.
 *
 * Die gezählte Menge wird zur Wahrheit, die Differenz zur Bewegung.
 * Zehn bis fünfzehn Artikel, unter fünf Minuten — mehr wird nicht
 * gezählt, sonst wird es nie gemacht.
 */
export async function inventurErfassen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const lagerortId = z.string().uuid().safeParse(formData.get("lagerortId"));
  if (!lagerortId.success) return { error: "Lagerort fehlt.", ok: null };

  const supabase = await createClient();

  /* Der Sollbestand kommt aus dem Journal, nicht aus dem Formular. */
  const { data: bestand } = await supabase
    .from("v_bestand")
    .select("artikel_id, menge")
    .eq("lagerort_id", lagerortId.data);

  const soll = new Map(
    ((bestand ?? []) as unknown as { artikel_id: string; menge: string }[]).map((b) => [
      b.artikel_id,
      Number(b.menge),
    ]),
  );

  let korrekturen = 0;
  for (const [key, wert] of formData.entries()) {
    if (!key.startsWith("ist:")) continue;
    const artikelId = key.slice("ist:".length);
    const text = String(wert).trim();
    if (text === "") continue;

    const ist = Number(text.replace(",", "."));
    if (!Number.isFinite(ist) || ist < 0) continue;

    const ergebnis = await inventurBuchen(supabase, {
      companyId: z1.me.companyId,
      userId: z1.me.id,
      lagerortId: lagerortId.data,
      artikelId,
      istMenge: ist,
      sollMenge: soll.get(artikelId) ?? 0,
    });

    if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };
    if (ergebnis.hinweis && ergebnis.hinweis !== "Keine Abweichung.") korrekturen++;
  }

  /*
   * Der Zähltermin steht am Lagerort — davon hängt die nächste
   * Fälligkeit ab. Am Fahrzeug stünde er für die Lagerrolle
   * unerreichbar, und die Inventur bliebe für immer fällig.
   */
  const { error: terminFehler } = await supabase
    .from("lagerort")
    .update({ letzte_inventur: new Date().toISOString().slice(0, 10) })
    .eq("id", lagerortId.data);

  if (terminFehler) {
    return { error: `Zähltermin nicht vermerkt: ${terminFehler.message}`, ok: null };
  }

  frisch();
  return {
    error: null,
    ok:
      korrekturen === 0
        ? "Gezählt, keine Abweichung."
        : `Gezählt, ${korrekturen} ${korrekturen === 1 ? "Korrektur" : "Korrekturen"} gebucht.`,
  };
}

/** Eine Seriennummer zum Vorgang erfassen. */
export async function seriennummerErfassen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      vorgangId: z.string().uuid(),
      artikelId: z.string().uuid(),
      nummer: z.string().trim().min(3, "Die Seriennummer ist zu kurz.").max(80),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("seriennummer").insert({
    company_id: z1.me.companyId,
    vorgang_id: d.vorgangId,
    artikel_id: d.artikelId,
    nummer: d.nummer,
    erfasst_von: z1.me.id,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        error: `${d.nummer} ist schon erfasst. Dieselbe Nummer zweimal heisst: eine davon ist falsch.`,
        ok: null,
      };
    }
    return { error: `Fehlgeschlagen: ${error.message}`, ok: null };
  }

  frisch(d.vorgangId);
  return { error: null, ok: `${d.nummer} vermerkt.` };
}
