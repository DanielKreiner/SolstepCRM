"use client";

import { useRef, useState } from "react";
import {
  mb,
  passtDurch,
  UPLOAD_MAX_BYTES,
  verkleinern,
} from "@/lib/bilder/verkleinern";

/**
 * Dateiauswahl für ein `<input type="file">`, das an eine Server Action geht.
 *
 * Grund für dieses Stück Code ist ein Fehler aus dem Betrieb: Ein Kunde
 * hat im Portal ein Foto vom Zählerkasten an eine Rückfrage gehängt und
 * statt einer Bestätigung „Application error" gelesen. Eine Server
 * Action nimmt ohne Angabe höchstens 1 MB Rumpf, ein Handyfoto ist drei-
 * bis fünfmal so gross, und die Anfrage brach ab, bevor eigener Code sie
 * sah. Die Grössenprüfung am Server lief deshalb nie — sie konnte nicht.
 *
 * Der Hook macht zwei Dinge, bevor das Formular abgeht:
 *
 *   1. Bilder verkleinern. Das löst den Fall endgültig und ist auf der
 *      Baustelle mit einem Balken Empfang ohnehin der Unterschied
 *      zwischen „gesendet" und „aufgegeben".
 *   2. Was dann noch zu gross ist — eine lange PDF etwa — melden und aus
 *      dem Feld nehmen. Eine Meldung ist kein Verlust, ein Absturz
 *      schon.
 *
 * Warum er an jedem Feld hängt und nicht nur im Portal: Dieselbe Grenze
 * traf die Checklisten-Aufnahme auf der Baustelle und die Personalakte.
 * Ein Fix an der gemeldeten Stelle allein wäre ein halber.
 *
 * Nicht gedacht für sehr grosse Dateien, bei denen die Auflösung der
 * Zweck ist — ein Drohnenfoto gehört direkt in den Speicher, nicht durch
 * eine Server Action. Den Weg dafür gibt es in `FotoLeiste`.
 */
export function useDateiAuswahl() {
  const feld = useRef<HTMLInputElement>(null);
  const [namen, setNamen] = useState<string[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function uebernehmen(gewaehlt: File[]): Promise<void> {
    setFehler(null);
    if (gewaehlt.length === 0) {
      setNamen([]);
      return;
    }

    setLaeuft(true);
    try {
      const klein = await Promise.all(gewaehlt.map(verkleinern));
      const zuGross = klein.filter((f) => !passtDurch(f.size));

      if (zuGross.length > 0) {
        /*
         * Auswahl zurücknehmen, nicht nur meldern: Bliebe die Datei im
         * Feld, nähme das Abschicken sie trotzdem mit und scheiterte
         * wieder am Rumpf der Anfrage — mit demselben Fehlerbildschirm.
         */
        leeren();
        const erste = zuGross[0]!;
        setFehler(
          zuGross.length === 1
            ? `„${erste.name}" ist mit ${mb(erste.size)} MB zu gross. Höchstens ${mb(UPLOAD_MAX_BYTES)} MB.`
            : `${zuGross.length} Dateien sind zu gross. Höchstens ${mb(UPLOAD_MAX_BYTES)} MB je Datei.`,
        );
        return;
      }

      /*
       * Die verkleinerten Dateien zurück ins Feld legen — nur so geht
       * das kleine Bild mit dem Formular raus und nicht das Original.
       * DataTransfer fehlt in manchen eingebetteten Ansichten; dann
       * bleibt das Original drin und die Grössenprüfung oben trägt.
       */
      if (feld.current && typeof DataTransfer === "function") {
        const sack = new DataTransfer();
        for (const f of klein) sack.items.add(f);
        feld.current.files = sack.files;
      }
      setNamen(klein.map((f) => f.name));
    } finally {
      setLaeuft(false);
    }
  }

  function leeren(): void {
    if (feld.current) feld.current.value = "";
    setNamen([]);
  }

  return {
    /** An das `<input type="file">` hängen. */
    feld,
    /** Als `onChange` des Feldes verwenden. */
    beiAuswahl: (e: React.ChangeEvent<HTMLInputElement>) =>
      void uebernehmen([...(e.target.files ?? [])]),
    namen,
    fehler,
    laeuft,
    leeren,
  };
}

/**
 * Die Zeile unter einem Dateifeld: Fehler, Fortschritt oder Auswahl.
 *
 * Steht hier, damit alle vier Felder dieselbe Rückmeldung geben. Am
 * Handy ist „hängt mein Foto wirklich dran" die häufigste Unsicherheit,
 * und sie sollte überall gleich beantwortet werden.
 */
export function dateiHinweis(stand: {
  namen: string[];
  fehler: string | null;
  laeuft: boolean;
}): { art: "fehler" | "laeuft" | "gewaehlt" | "leer"; text: string } {
  if (stand.fehler !== null) return { art: "fehler", text: stand.fehler };
  if (stand.laeuft) return { art: "laeuft", text: "Bild wird vorbereitet …" };
  if (stand.namen.length > 0) {
    return {
      art: "gewaehlt",
      text:
        stand.namen.length === 1
          ? `${stand.namen[0]} ausgewählt`
          : `${stand.namen.length} Dateien ausgewählt`,
    };
  }
  return {
    art: "leer",
    text: `Bilder oder PDF, höchstens ${mb(UPLOAD_MAX_BYTES)} MB. Fotos werden verkleinert, Standortdaten vor dem Ablegen entfernt.`,
  };
}
