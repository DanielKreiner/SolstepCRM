import { MAX_BYTES } from "@/lib/bilder/exif";

/*
 * Prüfung für Unterlagen, die ein Betrieb bei der Einrichtung hochlädt.
 *
 * Es gibt dafür schon `pruefeDatei` in lib/bilder/exif.ts — die Whitelist
 * dort kennt aber nur Bilder und PDF, weil sie für Baustellenfotos und
 * Anhänge entstanden ist. Die Unterlagen beim Start sind etwas anderes:
 * Der Kundenstamm kommt als CSV, der Lagerbestand als Excel-Datei. Beides
 * steht in CLAUDE.md 11 ausdrücklich in der erlaubten Liste, fehlte dort
 * aber.
 *
 * Deshalb eine eigene Liste und nicht die bestehende erweitert: Ein
 * Baustellenfoto soll keine Tabellendatei sein dürfen, und eine Whitelist,
 * die an zwei verschiedenen Stellen zwei verschiedene Dinge erlauben muss,
 * ist keine Whitelist mehr. Die Grössengrenze bleibt dieselbe und kommt
 * aus einer Quelle.
 *
 * Geprüft wird vor dem Upload, mit Name und Grösse aus dem Browser. Der
 * Content-Type ist eine Behauptung des Browsers — die Whitelist begrenzt
 * den Schaden, weil nichts Ausführbares dabei ist, und die Datei landet in
 * einem privaten Bucket, aus dem sie nur über eine signierte Adresse
 * wieder herauskommt.
 */

/*
 * Der Bucket für Unterlagen. Steht hier und nicht bei den Server
 * Actions: Aus einer "use server"-Datei lassen sich nur Funktionen
 * ausführen, und der Browser braucht den Namen für den Direkt-Upload.
 */
export const BUCKET_UNTERLAGEN = "documents";

/** Erlaubte Unterlagen — Whitelist, nicht Blacklist (CLAUDE.md 11). */
export const ERLAUBTE_UNTERLAGEN: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "text/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/**
 * Endungen, die wir akzeptieren, wenn der Browser keinen oder einen
 * unbrauchbaren Content-Type schickt.
 *
 * Das ist kein Randfall: Ein CSV aus einem alten Programm kommt in
 * Windows je nach Einstellung als `application/octet-stream` oder ganz
 * ohne Typ an. Ohne diesen Weg wäre genau die wichtigste Datei die, die
 * nicht hochgeladen werden kann.
 */
const ENDUNGEN = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "csv", "xls", "xlsx"]);

export function endungAus(dateiname: string): string {
  const treffer = /\.([a-z0-9]{1,5})$/i.exec(dateiname.trim());
  return treffer ? treffer[1]!.toLowerCase() : "";
}

export type UnterlagePruefung =
  | { ok: true; endung: string }
  | { ok: false; grund: string };

export function pruefeUnterlage(
  mime: string,
  groesse: number,
  dateiname: string,
): UnterlagePruefung {
  if (groesse <= 0) return { ok: false, grund: "Die Datei ist leer." };
  if (groesse > MAX_BYTES) {
    return {
      ok: false,
      grund: `Die Datei ist zu gross — höchstens ${Math.floor(MAX_BYTES / 1024 / 1024)} MB.`,
    };
  }

  const ausMime = ERLAUBTE_UNTERLAGEN[mime.toLowerCase().split(";")[0]!.trim()];
  if (ausMime) return { ok: true, endung: ausMime };

  const endung = endungAus(dateiname);
  if (ENDUNGEN.has(endung)) return { ok: true, endung: endung === "jpeg" ? "jpg" : endung };

  return {
    ok: false,
    grund: "Dieses Format geht nicht. Erlaubt sind PDF, Bilder, CSV und Excel.",
  };
}

/**
 * Dateiname für die Ablage.
 *
 * Der ursprüngliche Name bleibt in der Datenbank — er sagt dem Betrieb,
 * was er hochgeladen hat. Im Pfad steht eine entschärfte Fassung: Umlaute
 * und Leerzeichen in einem Storage-Pfad führen zu Adressen, die je nach
 * Client anders kodiert werden, und dann findet niemand die Datei wieder.
 */
export function pfadName(dateiname: string, endung: string): string {
  const stamm = dateiname
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${stamm || "datei"}.${endung}`;
}
