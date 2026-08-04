"use client";

import { useActionState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import {
  angebotSenden,
  angebotZurueckziehen,
} from "@/app/(app)/vorgaenge/versand-actions";

/**
 * Der Knopf, der das Angebot rausschickt.
 *
 * Vorher gab es ihn nicht: ein Angebot war sichtbar, sobald es existierte.
 * Der Kunde sah dann den Stand von halb drei, an dem noch gearbeitet
 * wurde. Jetzt ist es ein Entwurf, bis hier jemand drückt.
 */
export function Versand({
  vorgangId,
  versendetAm,
  gesehenAm,
  fassung,
  anzahlPositionen,
  kundeMail,
  hatPortal,
  gesperrt,
}: {
  vorgangId: string;
  versendetAm: string | null;
  gesehenAm: string | null;
  /** Nummer der zuletzt verschickten Fassung. */
  fassung: number | null;
  anzahlPositionen: number;
  kundeMail: string | null;
  hatPortal: boolean;
  gesperrt: boolean;
}) {
  const [status, senden] = useActionState<AktionsStatus, FormData>(
    angebotSenden,
    LEER,
  );
  const [zurueckStatus, zurueckziehen] = useActionState<AktionsStatus, FormData>(
    angebotZurueckziehen,
    LEER,
  );

  /*
   * Die Hürden vorher benennen statt hinterher: wer auf einen Knopf
   * drückt und eine Fehlermeldung bekommt, hat den Grund schon vorher
   * gehabt. Der Knopf bleibt trotzdem bedienbar — die Prüfung, die
   * zählt, sitzt in der Serveraktion.
   */
  const huerden = [
    anzahlPositionen === 0 ? "noch keine Positionen" : null,
    !kundeMail ? "keine Mailadresse beim Kunden" : null,
    !hatPortal ? "kein Portalzugang" : null,
  ].filter((h): h is string => h !== null);

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">An den Kunden</h2>
        {versendetAm ? (
          <Pill tone="done">
            Fassung {fassung ?? 1} versendet {kurz(versendetAm)}
          </Pill>
        ) : (
          <Pill tone="neutral">Entwurf</Pill>
        )}
        {gesehenAm ? <Pill tone="doing">gesehen {kurz(gesehenAm)}</Pill> : null}
      </div>

      <p className="mb-4 text-[12.5px] text-muted">
        {versendetAm
          ? gesehenAm
            ? "Der Kunde hat das Angebot geöffnet. Nachfassen kostet nichts."
            : "Verschickt, aber noch nicht geöffnet. Vielleicht steckt die Mail im Spam."
          : "Solange es ein Entwurf ist, sieht der Kunde im Portal nichts davon."}
      </p>

      {huerden.length > 0 && !versendetAm ? (
        <p className="mb-3 rounded-input bg-s-warn/14 px-4 py-3 text-[12.5px] text-accent-ink">
          Fehlt noch: {huerden.join(", ")}.
        </p>
      ) : null}

      {!gesperrt ? (
        <div className="flex flex-wrap items-center gap-2">
          <form action={senden}>
            <input type="hidden" name="vorgangId" value={vorgangId} />
            {/*
              Nach dem Senden ist der Editor weiter offen. Wer etwas
              ändert und erneut sendet, erzeugt die nächste Fassung —
              der Kunde sieht sie genau dann und keine Sekunde früher.
            */}
            <Knopf
              label={versendetAm ? `Als Fassung ${(fassung ?? 1) + 1} senden` : "Angebot senden"}
              haupt={!versendetAm}
            />
          </form>

          {versendetAm ? (
            <form action={zurueckziehen}>
              <input type="hidden" name="vorgangId" value={vorgangId} />
              <Knopf label="Zurückziehen" haupt={false} />
            </form>
          ) : null}

          <a
            href={`/api/pdf/vorgang/${vorgangId}?art=angebot`}
            target="_blank"
            rel="noreferrer"
            className="rounded-pill border border-line px-[18px] py-[9px] text-[12.5px] font-medium text-ink transition-colors hover:bg-sunk"
          >
            PDF ansehen
          </a>
        </div>
      ) : (
        <p className="text-[12.5px] text-faint">
          Der Auftrag läuft bereits — das Angebot ist damit abgeschlossen.
        </p>
      )}

      <Meldung status={status} />
      <Meldung status={zurueckStatus} />
    </section>
  );
}

function Knopf({ label, haupt }: { label: string; haupt: boolean }) {
  return (
    <button
      type="submit"
      className={[
        "min-h-[38px] cursor-pointer rounded-pill px-[20px] text-[12.5px] font-semibold transition-colors",
        haupt
          ? "border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white"
          : "border border-line bg-surface text-ink hover:bg-sunk",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function kurz(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
}
