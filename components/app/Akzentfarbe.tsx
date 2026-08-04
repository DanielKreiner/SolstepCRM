/*
 * Die Akzentfarbe des Mandanten für die ganze Oberfläche.
 *
 * Die Tokens in app/tokens.css bleiben der Standard; hier wird nur
 * überschrieben, wenn der Betrieb eine eigene Farbe gesetzt hat. Damit
 * gilt dieselbe Farbe im Cockpit, in den Mails und auf den Belegen —
 * eine Marke, eine Ablage (company.pdf_settings, CLAUDE.md 6.4).
 *
 * Als <style>-Block auf :root und nicht als Inline-Stil an einem
 * Container: die Farbe wird auch in Elementen gebraucht, die per Portal
 * ausserhalb des Baums landen — Dialoge, Toasts, die Befehlspalette.
 */

/** Farbe abdunkeln oder aufhellen. 0 lässt sie, negativ dunkelt ab. */
function mischen(hex: string, anteil: number): string {
  const n = parseInt(hex.slice(1), 16);
  const kanal = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const ziel = anteil > 0 ? 255 : 0;
    return Math.round(c + (ziel - c) * Math.abs(anteil));
  });
  return `#${kanal.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Wahrgenommene Helligkeit — entscheidet über die Textfarbe darauf. */
function helligkeit(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function Akzentfarbe({ akzent }: { akzent: string | null }) {
  /*
   * Nur echte Hexfarben. Der Wert landet ungefiltert in einem
   * <style>-Block — alles andere wäre eine Lücke, durch die ein
   * Einstellungsfeld CSS in jede Seite schreiben könnte.
   */
  if (!akzent || !/^#[0-9a-fA-F]{6}$/.test(akzent)) return null;

  const hell = helligkeit(akzent);

  /*
   * accent-ink ist die Linkfarbe auf heller Fläche. Eine helle
   * Akzentfarbe wäre dort unlesbar, deshalb wird sie abgedunkelt —
   * und eine sehr dunkle umgekehrt leicht aufgehellt.
   */
  const ink = hell > 0.55 ? mischen(akzent, -0.35) : mischen(akzent, 0.08);

  const css = `
:root {
  --accent: ${akzent};
  --accent-from: ${mischen(akzent, 0.14)};
  --accent-to: ${mischen(akzent, -0.16)};
  --accent-ink: ${ink};
  --accent-sunk: ${mischen(akzent, 0.9)};
}
[data-theme="dark"] {
  --accent-ink: ${mischen(akzent, 0.3)};
  --accent-sunk: ${mischen(akzent, -0.72)};
}`;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
