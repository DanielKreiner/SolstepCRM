"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import {
  fotoEntfernen,
  fotoVermerken,
  fotoZiel,
  type PlanerState,
} from "@/app/(app)/planer/actions";
import { createClient } from "@/lib/supabase/client";
import { type FotoQuelle, vorlaeufigerMassstab, type Werkzeug } from "./Leinwand";

/*
 * Drohnenfoto statt Karte (Briefing 2.3).
 *
 * Der Ablauf ist bewusst zweistufig: hochladen, dann kalibrieren. Ein
 * frisch hochgeladenes Foto hat keinen bekannten Massstab — es sieht nur
 * so aus, als hätte es einen. Solange nicht kalibriert ist, steht das
 * deutlich dran, und jede Länge im Bild ist geschätzt.
 */

const LEER: PlanerState = { error: null, ok: null };

export function FotoLeiste({
  projektId,
  foto,
  werkzeug,
  onWerkzeug,
}: {
  projektId: string;
  foto: FotoQuelle | null;
  werkzeug: Werkzeug;
  onWerkzeug: (w: Werkzeug) => void;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [wegStand, entfernen, entfernt] = useActionState(fotoEntfernen, LEER);
  const feld = useRef<HTMLInputElement>(null);

  /*
   * Kein eigenes window.location.reload(): die Aktionen rufen
   * revalidatePath, damit kommt die signierte Adresse ohnehin mit dem
   * nächsten Serverdurchlauf. Ein zusätzliches Neuladen kam eine Spur
   * später — mitten in die nächste Eingabe hinein, die es dann verwarf.
   */

  /**
   * Foto direkt zu Supabase laden, nicht durch die Server Action.
   *
   * Eine Server Action nimmt standardmässig ein Megabyte entgegen, auf
   * Vercel ist bei viereinhalb Schluss. Ein Drohnenfoto hat fünf bis
   * zwölf: Der Upload endete mit 500, und in der gebauten Fassung stand
   * nur „Application error: a client-side exception has occurred" — ohne
   * jeden Hinweis auf die Ursache.
   *
   * Jetzt holt der Browser eine signierte Adresse, lädt selbst hoch und
   * meldet nur Pfad und Bildmasse zurück.
   */
  async function gewaehlt() {
    const datei = feld.current?.files?.[0];
    if (!datei) return;
    setMeldung(null);

    if (datei.size > 25 * 1024 * 1024) {
      setMeldung("Höchstens 25 MB. Das Foto vorher verkleinern.");
      return;
    }

    const url = URL.createObjectURL(datei);
    setLaeuft(true);
    try {
      const bild = new Image();
      await new Promise<void>((fertig, fehler) => {
        bild.onload = () => fertig();
        bild.onerror = () => fehler(new Error("kein Bild"));
        bild.src = url;
      });

      const endung = (datei.name.split(".").pop() ?? "jpg").toLowerCase();
      const ziel = await fotoZiel(projektId, endung);
      if ("fehler" in ziel) {
        setMeldung(ziel.fehler);
        return;
      }

      const db = createClient();
      const { error } = await db.storage
        .from("planer-fotos")
        .uploadToSignedUrl(ziel.pfad, ziel.token, datei, { upsert: true });
      if (error) {
        setMeldung(`Hochladen fehlgeschlagen: ${error.message}`);
        return;
      }

      const stand = await fotoVermerken({
        id: projektId,
        pfad: ziel.pfad,
        breite: bild.naturalWidth,
        hoehe: bild.naturalHeight,
      });
      if (stand.error) {
        setMeldung(stand.error);
        return;
      }
      /*
       * Neu holen: Die signierte Leseadresse entsteht serverseitig, und
       * ohne Aktualisierung bliebe die Karte stehen.
       */
      router.refresh();
    } catch {
      setMeldung("Die Datei liess sich nicht als Bild lesen.");
    } finally {
      setLaeuft(false);
      URL.revokeObjectURL(url);
    }
  }

  if (!foto) {
    return (
      <section className="rounded-[12px] border border-line bg-surface p-3.5">
        <h3 className="text-[13px] font-bold">Bildquelle</h3>
        <p className="mt-1 text-[12px] leading-[1.45] text-muted">
          Standard ist das Luftbild. Ein Drohnenfoto ist schärfer und aktueller — es braucht
          danach eine Kalibrierung.
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <input
            ref={feld}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Drohnenfoto hochladen"
            onChange={gewaehlt}
            className="w-full text-[12px] text-muted file:mr-2 file:h-9 file:rounded-[10px] file:border file:border-line file:bg-sunk file:px-3 file:text-[12.5px] file:font-semibold file:text-ink"
          />
        </div>
        {laeuft ? <p className="mt-1.5 text-[11.5px] text-muted">lädt hoch …</p> : null}
        {meldung ? (
          <p className="mt-1.5 text-[12px] font-semibold text-s-crit">{meldung}</p>
        ) : null}
      </section>
    );
  }

  const kalibriert = foto.meterProPixel != null;
  const mpp = foto.meterProPixel ?? vorlaeufigerMassstab(foto.breite);

  return (
    <section className="rounded-[12px] border border-pl-mess bg-surface p-3.5">
      <div className="flex items-center gap-2">
      <h3 className="text-[13px] font-bold">Drohnenfoto</h3>
      <span
        className={[
          "rounded-pill px-2.5 py-0.5 text-[11.5px] font-semibold",
          kalibriert ? "bg-accent-sunk text-accent-ink" : "bg-s-crit text-white",
        ].join(" ")}
      >
        {kalibriert ? "kalibriert" : "nicht kalibriert"}
      </span>
      </div>

      <p className="num mt-1.5 text-[11.5px] tabular-nums text-muted">
        {(mpp * 100).toFixed(2).replace(".", ",")} cm je Bildpunkt
        {kalibriert ? "" : " (geschätzt)"}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">

      <button
        type="button"
        onClick={() => onWerkzeug(werkzeug === "kalibrieren" ? "auswahl" : "kalibrieren")}
        aria-pressed={werkzeug === "kalibrieren"}
        className={[
          "h-9 rounded-[10px] border px-3 text-[12.5px]",
          werkzeug === "kalibrieren" ? "border-accent bg-accent-sunk font-semibold" : "border-line",
        ].join(" ")}
      >
        {kalibriert ? "Neu kalibrieren" : "Kalibrieren"}
      </button>

      <button
        type="button"
        disabled={!kalibriert}
        title={kalibriert ? "Zweite Strecke quer zur ersten prüfen" : "Zuerst kalibrieren."}
        onClick={() => onWerkzeug(werkzeug === "gegenprobe" ? "auswahl" : "gegenprobe")}
        aria-pressed={werkzeug === "gegenprobe"}
        className={[
          "h-9 rounded-[10px] border px-3 text-[12.5px]",
          werkzeug === "gegenprobe" ? "border-accent bg-accent-sunk font-semibold" : "border-line",
          kalibriert ? "" : "cursor-not-allowed text-muted/45",
        ].join(" ")}
      >
        Gegenprobe
      </button>

      </div>

      <form action={entfernen} className="mt-2.5">
        <input type="hidden" name="id" value={projektId} />
        <button type="submit" disabled={entfernt} className="text-[12px] text-muted hover:text-s-crit">
          {entfernt ? "entfernt …" : "Foto entfernen"}
        </button>
      </form>

      {wegStand.error ? (
        <span className="text-[12px] font-semibold text-s-crit">{wegStand.error}</span>
      ) : null}
      {!kalibriert ? (
        <p className="mt-2 text-[11.5px] leading-[1.45] text-muted">
          Ohne Kalibrierung sind alle Längen im Bild geschätzt. Eine Strecke ziehen, deren wahres
          Mass bekannt ist — Firstlänge, Garagentor, ein Auto.
        </p>
      ) : null}
    </section>
  );
}
