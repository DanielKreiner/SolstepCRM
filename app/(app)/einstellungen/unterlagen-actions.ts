"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  BUCKET_UNTERLAGEN as BUCKET,
  pfadName,
  pruefeUnterlage,
} from "@/lib/dateien/unterlagen";
import { zugangHash, zugangToken } from "@/lib/einrichtung/zugang";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Die offenen Punkte beim Start: beantworten, Dateien dazulegen.
 *
 * Geschrieben wird mit dem normalen Client und damit unter RLS — die
 * Policies aus 0078 sind die Grenze, nicht diese Datei. Was hier steht,
 * ist die Prüfung der Eingabe und die Ablage der Datei.
 */

export type UnterlagenState = { error: string | null; ok: string | null };

async function zugang() {
  const me = await requireMe();
  if (me.perms.einstellungen !== "write") {
    return {
      ok: false as const,
      status: { error: "Keine Berechtigung für Einstellungen.", ok: null },
    };
  }
  if (me.company.status !== "active") {
    return {
      ok: false as const,
      status: { error: "Der Zugang ist derzeit nur lesend.", ok: null },
    };
  }
  return { ok: true as const, me };
}

const antwortSchema = z.object({
  id: z.string().uuid(),
  /*
   * Grosszügig bemessen: Bei „was ist aufgefallen" schreibt ein Betrieb
   * schon mal eine halbe Seite, und das soll nicht am Limit scheitern.
   */
  wert: z.string().trim().max(4000).optional().default(""),
  anmerkung: z.string().trim().max(1000).optional().default(""),
});

/**
 * Eine Antwort speichern.
 *
 * Der Status wird hier gesetzt und nicht vom Browser übernommen: Ob ein
 * Punkt beantwortet ist, ergibt sich daraus, ob etwas drinsteht, und das
 * weiss der Server besser.
 */
export async function punktSpeichern(
  _prev: UnterlagenState,
  formData: FormData,
): Promise<UnterlagenState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  /*
   * Mehrfachauswahl kommt als mehrere Felder gleichen Namens herein.
   * getAll() fasst sie zusammen; bei allen anderen Arten ist es genau
   * eines und das Ergebnis identisch.
   */
  const mehrfach = formData
    .getAll("wahl")
    .map((v) => String(v).trim())
    .filter(Boolean);

  const parsed = antwortSchema.safeParse({
    id: formData.get("id"),
    wert: mehrfach.length > 0 ? mehrfach.join(", ") : (formData.get("wert") ?? ""),
    anmerkung: formData.get("anmerkung") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }
  const d = parsed.data;

  const supabase = await createClient();

  const { data: punkt } = await supabase
    .from("einrichtung_punkt")
    .select("id, titel, art")
    .eq("id", d.id)
    .maybeSingle();

  if (!punkt) return { error: "Der Punkt ist nicht mehr da.", ok: null };

  /*
   * Bei einem Datei-Punkt gibt es keinen Wert — dort zählen die
   * Dateien. Der Status bleibt deshalb unberührt, sonst würde eine
   * blosse Anmerkung den Punkt als beantwortet ausgeben, obwohl die
   * Datei fehlt.
   */
  const istDatei = punkt.art === "datei";
  const beantwortet = d.wert.length > 0;

  const { error } = await supabase
    .from("einrichtung_punkt")
    .update(
      istDatei
        ? { anmerkung: d.anmerkung || null }
        : {
            wert: d.wert || null,
            anmerkung: d.anmerkung || null,
            status: beantwortet ? "beantwortet" : "offen",
            beantwortet_am: beantwortet ? new Date().toISOString() : null,
            beantwortet_von: beantwortet ? z1.me.id : null,
          },
    )
    .eq("id", d.id);

  if (error) return { error: `Speichern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Gespeichert." };
}

/**
 * Einen Punkt als „betrifft uns nicht" markieren — und zurück.
 *
 * Ohne diesen Weg bleibt eine Liste für immer unvollständig, weil ein
 * Betrieb eben keine Reverse-Charge-Rechnungen schreibt. Dann schaut
 * niemand mehr hin, und das ist schlimmer als ein offener Punkt.
 */
export async function punktEntfaellt(
  _prev: UnterlagenState,
  formData: FormData,
): Promise<UnterlagenState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = z
    .object({ id: z.string().uuid(), zurueck: z.string().optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Der Punkt ist nicht mehr da.", ok: null };

  const zurueck = parsed.data.zurueck === "ja";
  const supabase = await createClient();

  const { error } = await supabase
    .from("einrichtung_punkt")
    .update(
      zurueck
        ? { status: "offen", beantwortet_am: null, beantwortet_von: null }
        : {
            status: "entfaellt",
            beantwortet_am: new Date().toISOString(),
            beantwortet_von: z1.me.id,
          },
    )
    .eq("id", parsed.data.id);

  if (error) return { error: `Ändern fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: zurueck ? "Wieder offen." : "Als nicht nötig vermerkt." };
}

/**
 * Eine signierte Adresse zum Hochladen holen.
 *
 * Die Datei geht vom Browser direkt in den Speicher und nicht durch eine
 * Server Action. Das ist hier keine Feinheit: Eine Server Action nimmt
 * rund vier Megabyte, ein gescannter Kundenstamm oder eine
 * Lieferantenrechnung hat mehr, und die Anfrage bricht ab, bevor eigener
 * Code sie sieht. Derselbe Fehler ist im Kundenportal schon einmal als
 * „Application error" aufgeschlagen.
 *
 * Der Pfad entsteht serverseitig. Käme er vom Browser, könnte er in
 * einen fremden Mandantenordner zeigen — die Storage-Policy würde das
 * abweisen, aber darauf soll sich hier nichts verlassen.
 */
export async function dateiZiel(
  punktId: string,
  dateiname: string,
  mime: string,
  groesse: number,
): Promise<{ pfad: string; token: string } | { fehler: string }> {
  const z1 = await zugang();
  if (!z1.ok) return { fehler: z1.status.error ?? "Kein Zugriff." };

  const id = z.string().uuid().safeParse(punktId);
  if (!id.success) return { fehler: "Der Punkt ist nicht mehr da." };

  const name = z.string().trim().min(1).max(200).safeParse(dateiname);
  if (!name.success) return { fehler: "Die Datei hat keinen brauchbaren Namen." };

  const pruefung = pruefeUnterlage(mime, groesse, name.data);
  if (!pruefung.ok) return { fehler: pruefung.grund };

  const supabase = await createClient();

  /* Gehört der Punkt überhaupt zu diesem Mandanten? Die Abfrage läuft
     unter RLS, ein fremder Punkt kommt hier als nicht gefunden an. */
  const { data: punkt } = await supabase
    .from("einrichtung_punkt")
    .select("id")
    .eq("id", id.data)
    .maybeSingle();
  if (!punkt) return { fehler: "Der Punkt ist nicht mehr da." };

  /* Pfadschema aus CLAUDE.md 4.4. */
  const pfad = `${z1.me.companyId}/einrichtung/${id.data}/${randomUUID()}-${pfadName(
    name.data,
    pruefung.endung,
  )}`;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(pfad);
  if (error || !data) return { fehler: "Der Upload liess sich nicht vorbereiten." };

  return { pfad: data.path, token: data.token };
}

const vermerkSchema = z.object({
  punktId: z.string().uuid(),
  pfad: z.string().min(10).max(400),
  dateiname: z.string().trim().min(1).max(200),
  mime: z.string().max(120).optional().default(""),
  groesse: z.number().int().min(1),
});

/**
 * Die hochgeladene Datei vermerken.
 *
 * Getrennt vom Upload, weil durch diese Aktion nur ein paar Felder
 * gehen und nicht die Datei.
 */
export async function dateiVermerken(daten: {
  punktId: string;
  pfad: string;
  dateiname: string;
  mime: string;
  groesse: number;
}): Promise<UnterlagenState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const parsed = vermerkSchema.safeParse(daten);
  if (!parsed.success) return { error: "Angaben zur Datei fehlen.", ok: null };
  const d = parsed.data;

  /*
   * Der Pfad muss im eigenen Ordner und beim richtigen Punkt liegen.
   * Er kommt aus `dateiZiel`, aber diese Aktion ist von aussen
   * aufrufbar wie jede andere.
   */
  if (!d.pfad.startsWith(`${z1.me.companyId}/einrichtung/${d.punktId}/`)) {
    return { error: "Der Dateipfad passt nicht zum Punkt.", ok: null };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("einrichtung_datei").insert({
    company_id: z1.me.companyId,
    punkt_id: d.punktId,
    dateiname: d.dateiname,
    storage_path: d.pfad,
    mime: d.mime || null,
    groesse_bytes: d.groesse,
    hochgeladen_von: z1.me.id,
  });

  if (error) return { error: `Vermerken fehlgeschlagen: ${error.message}`, ok: null };

  /* Mit der ersten Datei ist der Punkt beantwortet. */
  await supabase
    .from("einrichtung_punkt")
    .update({
      status: "beantwortet",
      beantwortet_am: new Date().toISOString(),
      beantwortet_von: z1.me.id,
    })
    .eq("id", d.punktId);

  revalidatePath("/einstellungen");
  return { error: null, ok: `„${d.dateiname}" liegt bei.` };
}

export async function dateiEntfernen(
  _prev: UnterlagenState,
  formData: FormData,
): Promise<UnterlagenState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Die Datei ist nicht mehr da.", ok: null };

  const supabase = await createClient();

  const { data: datei } = await supabase
    .from("einrichtung_datei")
    .select("id, punkt_id, dateiname, storage_path")
    .eq("id", id.data)
    .maybeSingle();

  if (!datei) return { error: "Die Datei ist nicht mehr da.", ok: null };

  const { error } = await supabase.from("einrichtung_datei").delete().eq("id", id.data);
  if (error) return { error: `Entfernen fehlgeschlagen: ${error.message}`, ok: null };

  /*
   * Erst die Zeile, dann die Datei. In der anderen Reihenfolge bliebe
   * bei einem Fehler ein Eintrag stehen, der auf nichts zeigt — und der
   * Betrieb sieht eine Unterlage, die es nicht mehr gibt.
   */
  await supabase.storage.from(BUCKET).remove([datei.storage_path as string]);

  /* War es die letzte Datei, ist der Punkt wieder offen. */
  const { count } = await supabase
    .from("einrichtung_datei")
    .select("id", { count: "exact", head: true })
    .eq("punkt_id", datei.punkt_id as string);

  if ((count ?? 0) === 0) {
    await supabase
      .from("einrichtung_punkt")
      .update({ status: "offen", beantwortet_am: null, beantwortet_von: null })
      .eq("id", datei.punkt_id as string);
  }

  revalidatePath("/einstellungen");
  return { error: null, ok: `„${datei.dateiname as string}" entfernt.` };
}

/* ------------------------------------------------------- Link ohne Konto */

/*
 * Ein Link, der die Einrichtungsliste ohne Anmeldung öffnet.
 *
 * Grund: Wer die Angaben hat, hat oft keinen Zugang. Den Kundenstamm
 * exportiert der Steuerberater, den Resturlaub kennt die Lohnverrechnung,
 * die Freigabe für das Postfach macht die EDV-Betreuung. Für drei
 * Angaben legt niemand ein Konto an — und ohne Link landet alles wieder
 * in einer Mail.
 */

export type LinkErzeugtState = {
  error: string | null;
  ok: string | null;
  /** Nur direkt nach dem Erzeugen gefüllt. Danach steht nur der Hash in der Datenbank. */
  token: string | null;
};

export async function linkErzeugen(
  _prev: LinkErzeugtState,
  formData: FormData,
): Promise<LinkErzeugtState> {
  const z1 = await zugang();
  if (!z1.ok) return { ...z1.status, token: null };

  const zweck = z
    .string()
    .trim()
    .max(80)
    .optional()
    .safeParse(formData.get("zweck") ?? undefined);

  const token = zugangToken(z1.me.companyId);

  const supabase = await createClient();
  const { error } = await supabase.from("einrichtung_zugang").insert({
    company_id: z1.me.companyId,
    token_hash: zugangHash(token),
    zweck: zweck.success && zweck.data ? zweck.data : null,
    expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    erstellt_von: z1.me.id,
  });

  if (error) return { error: `Link anlegen fehlgeschlagen: ${error.message}`, ok: null, token: null };

  revalidatePath("/einstellungen");
  return {
    error: null,
    ok: "Link erzeugt. Er wird nur dieses eine Mal angezeigt.",
    token,
  };
}

export async function linkWiderrufen(
  _prev: UnterlagenState,
  formData: FormData,
): Promise<UnterlagenState> {
  const z1 = await zugang();
  if (!z1.ok) return z1.status;

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Der Link ist nicht mehr da.", ok: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("einrichtung_zugang")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id.data);

  if (error) return { error: `Zurückziehen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/einstellungen");
  return { error: null, ok: "Der Link geht nicht mehr auf." };
}
