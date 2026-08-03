import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { exifEntfernen, pruefeDatei } from "@/lib/bilder/exif";

/**
 * Gespräch, Rückfragen und Anhänge am Vorgang — an einer Stelle.
 *
 * Beide Seiten schreiben in dieselben Tabellen: das Backoffice mit dem
 * RLS-Client des Nutzers, das Portal mit dem Service-Role-Client nach
 * eigener Prüfung. Zwei Fassungen wären zwei Wahrheiten darüber, was ein
 * Anhang ist und wie er geprüft wird — und die Prüfung ist hier der
 * ganze Punkt.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/** Bilder und Belege liegen im bestehenden, privaten Bucket. */
export const BUCKET = "job-photos";

export type Nachricht = {
  id: string;
  autor: "kunde" | "betrieb";
  autorName: string | null;
  body: string;
  intern: boolean;
  anfrageId: string | null;
  createdAt: string;
  anhaenge: Anhang[];
};

export type Anhang = {
  id: string;
  dateiname: string;
  mime: string;
  groesseBytes: number;
  storagePath: string;
  /** Signierte Adresse, 60 Minuten gültig. */
  url: string | null;
};

export type Anfrage = {
  id: string;
  titel: string;
  beschreibung: string | null;
  fotoNoetig: boolean;
  status: string;
  antwortText: string | null;
  beantwortetAm: string | null;
  createdAt: string;
  anhaenge: Anhang[];
};

/**
 * Eine Datei annehmen.
 *
 * Geprüft wird Typ, Grösse und bei JPEG die Signatur — der Content-Type
 * kommt vom Browser und ist eine Behauptung. Danach fliegt EXIF raus:
 * ein Handyfoto vom Zählerkasten trägt die Koordinaten des Wohnhauses
 * (CLAUDE.md Abschnitt 11).
 */
export async function anhangSpeichern(
  supabase: Client,
  opts: {
    companyId: string;
    vorgangId: string;
    datei: File;
    von: "kunde" | "betrieb";
    nachrichtId?: string | null;
    anfrageId?: string | null;
  },
): Promise<{ ok: true; id: string } | { ok: false; grund: string }> {
  const roh = new Uint8Array(await opts.datei.arrayBuffer());
  const pruefung = pruefeDatei(opts.datei.type, roh.byteLength, roh);
  if (!pruefung.ok) return { ok: false, grund: pruefung.grund };

  const bytes = exifEntfernen(roh);

  /* Pfadschema wie überall: {company_id}/{entity}/{entity_id}/{uuid}-{name} */
  const sauber = opts.datei.name
    .replace(/[^\w.\- ]+/g, "_")
    .slice(-80);
  const pfad = `${opts.companyId}/vorgang/${opts.vorgangId}/${crypto.randomUUID()}-${sauber}`;

  const { error: hochFehler } = await supabase.storage
    .from(BUCKET)
    .upload(pfad, bytes, { contentType: opts.datei.type, upsert: false });

  if (hochFehler) {
    return { ok: false, grund: `Hochladen fehlgeschlagen: ${hochFehler.message}` };
  }

  const { data, error } = await supabase
    .from("vorgang_anhang")
    .insert({
      company_id: opts.companyId,
      vorgang_id: opts.vorgangId,
      nachricht_id: opts.nachrichtId ?? null,
      anfrage_id: opts.anfrageId ?? null,
      storage_path: pfad,
      dateiname: sauber,
      mime: opts.datei.type,
      groesse_bytes: bytes.byteLength,
      hochgeladen_von: opts.von,
    })
    .select("id")
    .single();

  if (error || !data) {
    /* Ohne Zeile ist die Datei nicht auffindbar — also wieder weg damit. */
    await supabase.storage.from(BUCKET).remove([pfad]);
    return { ok: false, grund: `Anhang konnte nicht abgelegt werden: ${error?.message}` };
  }

  return { ok: true, id: data.id as string };
}

/**
 * Signierte Adressen für eine Liste von Anhängen.
 *
 * Der Bucket ist privat. Ohne Signatur kommt niemand an die Datei, auch
 * nicht mit dem Pfad — das ist bei Kundenfotos die richtige Voreinstellung.
 */
export async function anhaengeMitUrl(
  supabase: Client,
  zeilen: AnhangRoh[],
): Promise<Map<string, Anhang[]>> {
  const je = new Map<string, Anhang[]>();
  if (zeilen.length === 0) return je;

  const { data: signiert } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      zeilen.map((z) => z.storage_path),
      60 * 60,
    );

  const url = new Map<string, string>();
  for (const s of signiert ?? []) {
    if (s.path && s.signedUrl) url.set(s.path, s.signedUrl);
  }

  for (const z of zeilen) {
    const schluessel = z.nachricht_id ?? z.anfrage_id ?? "";
    const liste = je.get(schluessel) ?? [];
    liste.push({
      id: z.id,
      dateiname: z.dateiname,
      mime: z.mime,
      groesseBytes: z.groesse_bytes,
      storagePath: z.storage_path,
      url: url.get(z.storage_path) ?? null,
    });
    je.set(schluessel, liste);
  }

  return je;
}

export type AnhangRoh = {
  id: string;
  nachricht_id: string | null;
  anfrage_id: string | null;
  storage_path: string;
  dateiname: string;
  mime: string;
  groesse_bytes: number;
};

/** Gespräch und Rückfragen eines Vorgangs. */
export async function chatLesen(
  supabase: Client,
  vorgangId: string,
  opts: { nurKundensicht: boolean },
): Promise<{ nachrichten: Nachricht[]; anfragen: Anfrage[] }> {
  const nachrichtenAbfrage = supabase
    .from("vorgang_nachricht")
    .select("id, autor, autor_name, body, intern, anfrage_id, created_at")
    .eq("vorgang_id", vorgangId)
    .order("created_at");

  const [{ data: nachrichten }, { data: anfragen }, { data: anhaenge }] =
    await Promise.all([
      opts.nurKundensicht
        ? nachrichtenAbfrage.eq("intern", false)
        : nachrichtenAbfrage,
      supabase
        .from("vorgang_anfrage")
        .select(
          "id, titel, beschreibung, foto_noetig, status, antwort_text, beantwortet_am, created_at",
        )
        .eq("vorgang_id", vorgangId)
        .order("created_at", { ascending: false }),
      supabase
        .from("vorgang_anhang")
        .select("id, nachricht_id, anfrage_id, storage_path, dateiname, mime, groesse_bytes")
        .eq("vorgang_id", vorgangId),
    ]);

  const je = await anhaengeMitUrl(supabase, (anhaenge ?? []) as unknown as AnhangRoh[]);

  return {
    nachrichten: ((nachrichten ?? []) as unknown as NachrichtRoh[]).map((n) => ({
      id: n.id,
      autor: n.autor,
      autorName: n.autor_name,
      body: n.body,
      intern: n.intern,
      anfrageId: n.anfrage_id,
      createdAt: n.created_at,
      anhaenge: je.get(n.id) ?? [],
    })),
    anfragen: ((anfragen ?? []) as unknown as AnfrageRoh[]).map((a) => ({
      id: a.id,
      titel: a.titel,
      beschreibung: a.beschreibung,
      fotoNoetig: a.foto_noetig,
      status: a.status,
      antwortText: a.antwort_text,
      beantwortetAm: a.beantwortet_am,
      createdAt: a.created_at,
      anhaenge: je.get(a.id) ?? [],
    })),
  };
}

type NachrichtRoh = {
  id: string;
  autor: "kunde" | "betrieb";
  autor_name: string | null;
  body: string;
  intern: boolean;
  anfrage_id: string | null;
  created_at: string;
};

type AnfrageRoh = {
  id: string;
  titel: string;
  beschreibung: string | null;
  foto_noetig: boolean;
  status: string;
  antwort_text: string | null;
  beantwortet_am: string | null;
  created_at: string;
};
