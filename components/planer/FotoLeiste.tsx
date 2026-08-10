"use client";

import { useActionState, useRef } from "react";
import { fotoEntfernen, fotoHochladen, type PlanerState } from "@/app/(app)/planer/actions";
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
  const [hochStand, hochladen, laedt] = useActionState(fotoHochladen, LEER);
  const [wegStand, entfernen, entfernt] = useActionState(fotoEntfernen, LEER);
  const feld = useRef<HTMLInputElement>(null);
  const formular = useRef<HTMLFormElement>(null);
  const breiteFeld = useRef<HTMLInputElement>(null);
  const hoeheFeld = useRef<HTMLInputElement>(null);

  /*
   * Kein eigenes window.location.reload(): die Aktionen rufen
   * revalidatePath, damit kommt die signierte Adresse ohnehin mit dem
   * nächsten Serverdurchlauf. Ein zusätzliches Neuladen kam eine Spur
   * später — mitten in die nächste Eingabe hinein, die es dann verwarf.
   */

  /** Bildmasse lesen, bevor abgeschickt wird — der Server kennt sie sonst nicht. */
  async function gewaehlt() {
    const datei = feld.current?.files?.[0];
    if (!datei) return;
    const url = URL.createObjectURL(datei);
    try {
      const bild = new Image();
      await new Promise<void>((fertig, fehler) => {
        bild.onload = () => fertig();
        bild.onerror = () => fehler(new Error("kein Bild"));
        bild.src = url;
      });
      /*
       * Direkt in die Felder schreiben, nicht über React-State: der
       * Zustand wäre beim Absenden womöglich noch nicht gerendert, und
       * der Server bekäme Breite und Höhe als 0. Genau das ist sprunghaft
       * passiert — mal ging der Upload durch, mal nicht.
       */
      if (breiteFeld.current) breiteFeld.current.value = String(bild.naturalWidth);
      if (hoeheFeld.current) hoeheFeld.current.value = String(bild.naturalHeight);
      formular.current?.requestSubmit();
    } catch {
      /* Ungültige Datei — der Server lehnt sie ohnehin ab. */
    } finally {
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
        <form ref={formular} action={hochladen} className="mt-2.5 flex items-center gap-2">
          <input type="hidden" name="id" value={projektId} />
          <input ref={breiteFeld} type="hidden" name="breite" defaultValue="0" />
          <input ref={hoeheFeld} type="hidden" name="hoehe" defaultValue="0" />
          <input
            ref={feld}
            type="file"
            name="foto"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Drohnenfoto hochladen"
            onChange={gewaehlt}
            className="w-full text-[12px] text-muted file:mr-2 file:h-9 file:rounded-[10px] file:border file:border-line file:bg-sunk file:px-3 file:text-[12.5px] file:font-semibold file:text-ink"
          />
        </form>
        {laedt ? <p className="mt-1.5 text-[11.5px] text-muted">lädt hoch …</p> : null}
        {hochStand.error ? (
          <p className="mt-1.5 text-[12px] font-semibold text-s-crit">{hochStand.error}</p>
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
