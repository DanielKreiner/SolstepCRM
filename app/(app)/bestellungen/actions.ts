"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { AktionsStatus } from "@/components/ui/Formular";
import { bestellungAbschicken } from "@/lib/material/bestellung";
import { statusNachziehen, wareneingangBuchen } from "@/lib/material/buchen";
import { materialGateSchreiben } from "@/lib/material/daten";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Bestellungen.
 *
 * Die harte Regel des Moduls: es gibt keinen Wareneingang ohne
 * Bestellung. Alles hier dient dem einen Zweck, diese Regel im Alltag
 * erträglich zu machen — Sammelbestellung über mehrere Vorgänge,
 * Abholung in einem Schritt, Doppelbestell-Schutz.
 */

async function zugang() {
  const me = await requireMe();
  if (me.perms.pipelines !== "write" && me.perms.lager !== "write") {
    return {
      ok: false as const,
      status: { error: "Für Bestellungen fehlt deiner Rolle das Schreibrecht.", ok: null },
    };
  }
  if (me.company.status !== "active" && me.company.status !== "trial") {
    return {
      ok: false as const,
      status: { error: "Der Zugang ist derzeit nur lesend.", ok: null },
    };
  }
  return { ok: true as const, me };
}

/**
 * Eine Bestellung als Entwurf anlegen — leer oder aus Bedarfspositionen.
 *
 * Die Positionen kommen als Liste von Bedarfs-IDs. Sie dürfen aus
 * verschiedenen Vorgängen stammen; jede behält ihren Vorgangsbezug, damit
 * beim Wareneingang klar ist, wofür die Ware gedacht war.
 */
export async function bestellungAnlegen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const bedarfIds = formData
    .getAll("bedarfId")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/.test(s));

  const lieferantId = String(formData.get("lieferantId") ?? "");
  const supabase = await createClient();

  const { data: b, error } = await supabase
    .from("bestellung")
    .insert({
      company_id: z1.me.companyId,
      status: "entwurf",
      lieferant_id: lieferantId || null,
      created_by: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !b) {
    return { error: `Anlegen fehlgeschlagen: ${error?.message}`, ok: null };
  }

  if (bedarfIds.length > 0) {
    const { data: bedarf } = await supabase
      .from("vorgang_bedarf")
      .select("id, vorgang_id, artikel_id, bezeichnung, menge, einheit")
      .in("id", bedarfIds);

    const zeilen = (bedarf ?? []) as unknown as {
      id: string;
      vorgang_id: string;
      artikel_id: string | null;
      bezeichnung: string;
      menge: string;
      einheit: string;
    }[];

    if (zeilen.length > 0) {
      /*
       * Bestellt wird die offene Menge, nicht die Bedarfsmenge: was
       * schon im Lager liegt oder auf dem Vorgang gebucht ist, braucht
       * niemand ein zweites Mal.
       */
      const { error: posFehler } = await supabase.from("bestellposition").insert(
        zeilen.map((z, i) => ({
          company_id: z1.me.companyId,
          bestellung_id: b.id,
          artikel_id: z.artikel_id,
          bezeichnung: z.bezeichnung,
          menge: Number(z.menge),
          einheit: z.einheit,
          vorgang_id: z.vorgang_id,
          bedarf_id: z.id,
          sort: i * 10,
        })),
      );

      if (posFehler) {
        await supabase.from("bestellung").delete().eq("id", b.id);
        return { error: `Positionen fehlgeschlagen: ${posFehler.message}`, ok: null };
      }
    }
  }

  redirect(`/bestellungen/${b.id as string}`);
}

/** Kopfdaten eines Entwurfs ändern. */
export async function bestellungKopf(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      id: z.string().uuid(),
      lieferantId: z.string().uuid().optional().or(z.literal("")),
      ziel: z.enum(["hauptlager", "baustelle"]),
      zielVorgangId: z.string().uuid().optional().or(z.literal("")),
      wunschtermin: z.string().optional().or(z.literal("")),
      notiz: z.string().trim().max(1000).optional().default(""),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  if (d.ziel === "baustelle" && !d.zielVorgangId) {
    return {
      error: "Ziel Baustelle braucht einen Vorgang — von dort kommt die Adresse.",
      ok: null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("bestellung")
    .update({
      lieferant_id: d.lieferantId || null,
      ziel: d.ziel,
      ziel_vorgang_id: d.ziel === "baustelle" ? d.zielVorgangId : null,
      wunschtermin: d.wunschtermin || null,
      notiz: d.notiz || null,
    })
    .eq("id", d.id)
    .eq("status", "entwurf");

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/bestellungen/${d.id}`);
  return { error: null, ok: "Gespeichert." };
}

/** Eine freie Position ergänzen — Van-Stock, Lagerauffüllung, Kleinkram. */
export async function positionHinzufuegen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      bestellungId: z.string().uuid(),
      artikelId: z.string().uuid().optional().or(z.literal("")),
      bezeichnung: z.string().trim().max(200).optional().default(""),
      menge: z.coerce.number().gt(0, "Menge muss größer als null sein."),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const supabase = await createClient();

  let bezeichnung = d.bezeichnung;
  let einheit = "Stk";
  let ek: number | null = null;

  if (d.artikelId) {
    const { data: a } = await supabase
      .from("article")
      .select("name, unit, purchase_price")
      .eq("id", d.artikelId)
      .maybeSingle();
    if (!a) return { error: "Artikel nicht gefunden.", ok: null };
    bezeichnung = a.name as string;
    einheit = (a.unit as string) ?? "Stk";
    ek = a.purchase_price === null ? null : Number(a.purchase_price);
  }

  if (bezeichnung.trim().length < 2) {
    return { error: "Ohne Bezeichnung weiss der Lieferant nicht, was gemeint ist.", ok: null };
  }

  const { data: letzte } = await supabase
    .from("bestellposition")
    .select("sort")
    .eq("bestellung_id", d.bestellungId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("bestellposition").insert({
    company_id: z1.me.companyId,
    bestellung_id: d.bestellungId,
    artikel_id: d.artikelId || null,
    bezeichnung,
    menge: d.menge,
    einheit,
    ek_netto: ek,
    sort: Number(letzte?.sort ?? 0) + 10,
  });

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/bestellungen/${d.bestellungId}`);
  return { error: null, ok: `${bezeichnung} aufgenommen.` };
}

export async function positionEntfernen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ bestellungId: z.string().uuid(), id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bestellung")
    .select("status")
    .eq("id", parsed.data.bestellungId)
    .maybeSingle();

  if (b?.status !== "entwurf") {
    return {
      error: "Eine abgeschickte Bestellung ändert sich nicht mehr. Storniere die Position.",
      ok: null,
    };
  }

  const { error } = await supabase
    .from("bestellposition")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath(`/bestellungen/${parsed.data.bestellungId}`);
  return { error: null, ok: "Entfernt." };
}

/**
 * Der Statuswechsel entwurf → bestellt.
 *
 * Ab hier ist die Bestellung verbindlich: Nummer vergeben, PDF
 * archiviert, nicht mehr editierbar.
 */
export async function alsBestelltMarkieren(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      id: z.string().uuid(),
      mailSenden: z.enum(["ja", "nein"]).optional().default("nein"),
      externBestellt: z.enum(["ja", "nein"]).optional().default("nein"),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };
  const d = parsed.data;

  const supabase = await createClient();

  if (d.externBestellt === "ja") {
    await supabase
      .from("bestellung")
      .update({ extern_bestellt: true })
      .eq("id", d.id)
      .eq("status", "entwurf");
  }

  const ergebnis = await bestellungAbschicken(supabase, {
    companyId: z1.me.companyId,
    bestellungId: d.id,
    userId: z1.me.id,
    mailSenden: d.mailSenden === "ja",
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  await gatesNachziehen(supabase, z1.me.companyId, d.id);

  revalidatePath(`/bestellungen/${d.id}`);
  revalidatePath("/bestellungen");
  return {
    error: null,
    ok: `${ergebnis.nummer} ist raus.${
      ergebnis.gemailt ? " Die Mail an den Lieferanten liegt im Postausgang." : ""
    }`,
  };
}

/** Bestätigter Liefertermin je Position — er entscheidet über die Deckung. */
export async function terminSetzen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      bestellungId: z.string().uuid(),
      id: z.string().uuid(),
      termin: z.string().optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bestellposition")
    .update({ bestaetigter_termin: parsed.data.termin || null })
    .eq("id", parsed.data.id);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await gatesNachziehen(supabase, z1.me.companyId, parsed.data.bestellungId);

  revalidatePath(`/bestellungen/${parsed.data.bestellungId}`);
  return { error: null, ok: "Termin vermerkt." };
}

/** Restmenge stornieren — der Weg, eine abgeschickte Bestellung zu ändern. */
export async function positionStornieren(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ bestellungId: z.string().uuid(), id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Eingabe fehlt.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bestellposition")
    .update({ storniert: true })
    .eq("id", parsed.data.id);

  if (error) return { error: `Fehlgeschlagen: ${error.message}`, ok: null };

  await statusNachziehen(supabase, parsed.data.bestellungId);
  await gatesNachziehen(supabase, z1.me.companyId, parsed.data.bestellungId);

  revalidatePath(`/bestellungen/${parsed.data.bestellungId}`);
  return { error: null, ok: "Position storniert." };
}

/**
 * Die Material-Gates aller betroffenen Vorgänge nachrechnen.
 *
 * Eine Bestellung deckt Bedarf — und zwar quer über Vorgänge hinweg.
 * Ohne diesen Schritt bliebe ein Gate rot, obwohl längst bestellt ist.
 */
async function gatesNachziehen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  companyId: string,
  bestellungId: string,
): Promise<void> {
  const { data: pos } = await supabase
    .from("bestellposition")
    .select("vorgang_id")
    .eq("bestellung_id", bestellungId);

  const ids = new Set(
    ((pos ?? []) as { vorgang_id: string | null }[])
      .map((p) => p.vorgang_id)
      .filter((v): v is string => Boolean(v)),
  );

  for (const vorgangId of ids) {
    await materialGateSchreiben(supabase, { companyId, vorgangId });
  }
}

/* ------------------------------------------------------ WARENEINGANG */

/**
 * Ware gegen diese Bestellung einbuchen.
 *
 * Teillieferungen sind der Normalfall: zwölf von zwanzig kommen an, der
 * Rest bleibt offen. Was drüber hinausgeht, braucht eine ausdrückliche
 * Bestätigung und wird als Abweichung protokolliert.
 */
export async function wareneingangErfassen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const me = await requireMe();
  if (me.company.status !== "active" && me.company.status !== "trial") {
    return { error: "Der Zugang ist derzeit nur lesend.", ok: null };
  }

  const bestellungId = z.string().uuid().safeParse(formData.get("bestellungId"));
  if (!bestellungId.success) return { error: "Bestellung fehlt.", ok: null };

  const supabase0 = await createClient();
  const { data: kopf } = await supabase0
    .from("bestellung")
    .select("ziel")
    .eq("id", bestellungId.data)
    .maybeSingle();

  if (!kopf) return { error: "Bestellung nicht gefunden.", ok: null };

  /*
   * Wareneingang macht das Lager oder das Büro. Die eine Ausnahme ist
   * die Direktlieferung auf die Baustelle: dort steht nur der Monteur
   * davor, und nur er weiss, was tatsächlich abgeladen wurde. Ohne
   * diese Ausnahme müsste jemand im Büro bestätigen, was er nicht
   * gesehen hat.
   */
  const darf =
    me.perms.lager === "write" ||
    me.perms.pipelines === "write" ||
    (kopf.ziel === "baustelle" && me.perms.zeiterfassung === "write");

  if (!darf) {
    return { error: "Für den Wareneingang fehlt deiner Rolle das Recht.", ok: null };
  }

  const z1 = { ok: true as const, me };

  /*
   * Die Mengen kommen als Feldpaare menge:<positionId>. Alles, was leer
   * oder null ist, bedeutet „nicht mitgekommen" und wird übersprungen.
   */
  const zeilen: { bestellpositionId: string; menge: number }[] = [];
  for (const [key, wert] of formData.entries()) {
    if (!key.startsWith("menge:")) continue;
    const id = key.slice("menge:".length);
    const menge = Number(String(wert).replace(",", "."));
    if (!Number.isFinite(menge) || menge <= 0) continue;
    zeilen.push({ bestellpositionId: id, menge });
  }

  if (zeilen.length === 0) {
    return { error: "Keine Menge eingetragen.", ok: null };
  }

  const supabase = await createClient();
  const ergebnis = await wareneingangBuchen(supabase, {
    companyId: z1.me.companyId,
    userId: z1.me.id,
    bestellungId: bestellungId.data,
    zeilen,
    ueberlieferungOk: formData.get("ueberliefern") === "ja",
  });

  if (!ergebnis.ok) return { error: ergebnis.grund, ok: null };

  revalidatePath(`/bestellungen/${bestellungId.data}`);
  revalidatePath("/material");
  return {
    error: null,
    ok: `Eingebucht.${ergebnis.hinweis ? ` ${ergebnis.hinweis}` : ""}`,
  };
}

/**
 * Der Abholungs-Schnellweg.
 *
 * Jemand fährt zum Grosshändler und nimmt mit, was fehlt. Ohne diesen
 * Weg müsste er dafür eine Bestellung anlegen, abschicken und dann den
 * Eingang buchen — drei Schritte für einen Handgriff, und die
 * Bestellpflicht wäre am ersten Tag umgangen. Hier entsteht beides in
 * einem Zug, die Regel bleibt gewahrt.
 */
export async function abholungErfassen(
  _prev: AktionsStatus,
  formData: FormData,
): Promise<AktionsStatus> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({
      lieferantId: z.string().uuid(),
      artikelId: z.string().uuid(),
      menge: z.coerce.number().gt(0, "Menge muss größer als null sein."),
      vorgangId: z.string().uuid().optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;
  const supabase = await createClient();

  const { data: a } = await supabase
    .from("article")
    .select("name, unit, purchase_price")
    .eq("id", d.artikelId)
    .maybeSingle();
  if (!a) return { error: "Artikel nicht gefunden.", ok: null };

  const { data: b, error } = await supabase
    .from("bestellung")
    .insert({
      company_id: z1.me.companyId,
      status: "entwurf",
      lieferant_id: d.lieferantId,
      abholung: true,
      extern_bestellt: true,
      created_by: z1.me.id,
    })
    .select("id")
    .single();

  if (error || !b) return { error: `Anlegen fehlgeschlagen: ${error?.message}`, ok: null };

  const { data: pos, error: posFehler } = await supabase
    .from("bestellposition")
    .insert({
      company_id: z1.me.companyId,
      bestellung_id: b.id,
      artikel_id: d.artikelId,
      bezeichnung: a.name as string,
      menge: d.menge,
      einheit: (a.unit as string) ?? "Stk",
      ek_netto: a.purchase_price,
      vorgang_id: d.vorgangId || null,
    })
    .select("id")
    .single();

  if (posFehler || !pos) {
    await supabase.from("bestellung").delete().eq("id", b.id);
    return { error: `Position fehlgeschlagen: ${posFehler?.message}`, ok: null };
  }

  /* Abschicken erzeugt Nummer und Beleg-PDF — ohne Mail, es ist ja da. */
  const abgeschickt = await bestellungAbschicken(supabase, {
    companyId: z1.me.companyId,
    bestellungId: b.id as string,
    userId: z1.me.id,
    mailSenden: false,
  });

  if (!abgeschickt.ok) {
    return { error: abgeschickt.grund, ok: null };
  }

  const eingang = await wareneingangBuchen(supabase, {
    companyId: z1.me.companyId,
    userId: z1.me.id,
    bestellungId: b.id as string,
    zeilen: [{ bestellpositionId: pos.id as string, menge: d.menge }],
    ueberlieferungOk: false,
    notiz: "Abholung beim Grosshändler",
  });

  if (!eingang.ok) return { error: eingang.grund, ok: null };

  revalidatePath("/material");
  revalidatePath("/bestellungen");
  return {
    error: null,
    ok: `${abgeschickt.nummer}: ${d.menge} ${a.unit as string} ${a.name as string} abgeholt und eingebucht.`,
  };
}
