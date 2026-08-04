"use client";

import { useActionState, useState } from "react";
import { enqueue, flush } from "@/lib/offline/queue";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import { date, num } from "@/lib/format";
import {
  ladenAbhaken,
  rueckgabeErfassen,
  seriennummerErfassen,
  uebernahmeBestaetigen,
} from "@/app/(app)/material/actions";

export type Zeile = {
  bedarfId: string;
  artikelId: string;
  sku: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  seriennummernpflichtig: boolean;
  bereitgestellt: boolean;
  uebernommen: boolean;
  gebucht: number;
  liefertermin: string | null;
};

export type Block = {
  vorgangId: string;
  nummer: string;
  kunde: string;
  adresse: string | null;
  von: string;
  bis: string;
  zuLaden: Zeile[];
  aufBaustelle: Zeile[];
  fehlt: Zeile[];
};

/**
 * Ein Vorgang auf der Beladeliste.
 *
 * Drei Abschnitte, immer in derselben Reihenfolge: was zu laden ist, was
 * schon dort liegt, was fehlt. Der dritte ist der Grund, warum es diese
 * Ansicht gibt — fehlendes Material bemerkt man sonst auf dem Dach.
 *
 * Jeder Haken bucht sofort. Auch beim Beladen für morgen: das Material
 * ist physisch weg vom Lager, und der Bestand muss das abbilden.
 */
export function Beladeblock({
  block,
  kommissionieren,
  touch,
}: {
  block: Block;
  /** In der Lageransicht wird zusätzlich „bereitgestellt" vermerkt. */
  kommissionieren: boolean;
  /** Grössere Ziele in der Monteur-App. */
  touch: boolean;
}) {
  const [hakenStatus, haken] = useActionState<AktionsStatus, FormData>(
    ladenAbhaken,
    LEER,
  );
  const [uebernahmeStatus, uebernehmen] = useActionState<AktionsStatus, FormData>(
    uebernahmeBestaetigen,
    LEER,
  );

  /*
   * In der Monteur-App geht die Buchung über die Offline-Warteschlange
   * und nicht direkt zum Server: auf einem Dach ohne Netz muss das
   * Abhaken trotzdem gehen (CLAUDE.md Abschnitt 8). Im Lager am Schreib-
   * tisch gibt es kein Offline — dort ist die Serveraktion einfacher und
   * meldet Fehler sofort.
   */
  const [gebucht, setGebucht] = useState<Set<string>>(new Set());
  const [warteschlange, setWarteschlange] = useState<string | null>(null);

  async function offlineBuchen(
    art: "entnahme" | "rueckgabe",
    d: { artikelId: string; menge: number; bedarfId: string },
  ) {
    await enqueue("material", {
      vorgangId: block.vorgangId,
      artikelId: d.artikelId,
      menge: d.menge,
      art,
    });
    setGebucht(new Set([...gebucht, d.bedarfId]));
    setWarteschlange(art === "rueckgabe" ? "Zurückgebucht." : "Gebucht.");
    window.dispatchEvent(new Event("betrieb:queue"));
    void flush().then(() => window.dispatchEvent(new Event("betrieb:queue")));
  }

  const knopf = touch
    ? "min-h-[56px] px-[22px] text-[15px]"
    : "min-h-[38px] px-[18px] text-[12.5px]";

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{block.kunde}</h2>
        <span className="num text-[12px] text-muted">{block.nummer}</span>
        {block.fehlt.length > 0 ? (
          <Pill tone="crit">{block.fehlt.length} fehlt</Pill>
        ) : block.zuLaden.length === 0 ? (
          <Pill tone="done">nichts zu laden</Pill>
        ) : (
          <Pill tone="doing">{block.zuLaden.length} zu laden</Pill>
        )}
      </div>
      {block.adresse ? (
        <p className="mb-3 text-[12.5px] text-muted">{block.adresse}</p>
      ) : null}

      {block.zuLaden.length > 0 ? (
        <>
          <h3 className="mt-3 mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Zu laden
          </h3>
          <ul className="flex flex-col gap-[6px]">
            {block.zuLaden.map((z) => (
              <li
                key={z.bedarfId}
                className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel px-3 py-[10px]"
              >
                <span className="num w-[64px] shrink-0 text-right text-[14px] font-semibold">
                  {num(z.menge)}
                </span>
                <span className="w-[34px] shrink-0 text-[11.5px] text-faint">
                  {z.einheit}
                </span>
                <span className="min-w-[130px] flex-1">
                  <span className="block truncate text-[13.5px]">{z.bezeichnung}</span>
                  <span className="num block text-[11px] text-faint">
                    {z.sku ?? "Freitext"}
                    {z.seriennummernpflichtig ? " · Seriennummer nötig" : ""}
                  </span>
                </span>

                {z.bereitgestellt && !kommissionieren ? (
                  <form action={uebernehmen}>
                    <input type="hidden" name="bedarfId" value={z.bedarfId} />
                    <input type="hidden" name="vorgangId" value={block.vorgangId} />
                    <button
                      type="submit"
                      className={`cursor-pointer rounded-pill border border-line bg-surface font-semibold text-ink transition-colors hover:bg-sunk ${knopf}`}
                    >
                      Übernommen
                    </button>
                  </form>
                ) : touch ? (
                  <button
                    type="button"
                    disabled={gebucht.has(z.bedarfId)}
                    onClick={() =>
                      void offlineBuchen("entnahme", {
                        artikelId: z.artikelId,
                        menge: z.menge,
                        bedarfId: z.bedarfId,
                      })
                    }
                    className={[
                      "rounded-pill border-0 font-semibold text-white",
                      gebucht.has(z.bedarfId)
                        ? "cursor-default bg-s-done"
                        : "cursor-pointer bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))]",
                      knopf,
                    ].join(" ")}
                  >
                    {gebucht.has(z.bedarfId) ? "Geladen ✓" : "Geladen"}
                  </button>
                ) : (
                  <form action={haken}>
                    <input type="hidden" name="vorgangId" value={block.vorgangId} />
                    <input type="hidden" name="artikelId" value={z.artikelId} />
                    <input type="hidden" name="bedarfId" value={z.bedarfId} />
                    <input type="hidden" name="menge" value={z.menge} />
                    {kommissionieren ? (
                      <input type="hidden" name="bereitstellen" value="ja" />
                    ) : null}
                    <button
                      type="submit"
                      className={`cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] font-semibold text-white ${knopf}`}
                    >
                      {kommissionieren ? "Bereitgestellt" : "Geladen"}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {block.aufBaustelle.length > 0 ? (
        <>
          <h3 className="mt-4 mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
            Bereits auf der Baustelle
          </h3>
          <ul className="flex flex-col gap-[5px]">
            {block.aufBaustelle.map((z) => (
              <li
                key={`da-${z.bedarfId}`}
                className="flex items-center gap-3 rounded-card bg-sunk px-3 py-[8px]"
              >
                <span className="num w-[64px] shrink-0 text-right text-[13px]">
                  {num(z.menge)}
                </span>
                <span className="w-[34px] shrink-0 text-[11.5px] text-faint">
                  {z.einheit}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {z.bezeichnung}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {block.fehlt.length > 0 ? (
        <>
          <h3 className="mt-4 mb-2 text-[12px] font-semibold tracking-wide text-s-crit uppercase">
            Fehlt noch
          </h3>
          <ul className="flex flex-col gap-[5px]">
            {block.fehlt.map((z) => (
              <li
                key={`weg-${z.bedarfId}`}
                className="flex flex-wrap items-center gap-3 rounded-card bg-s-crit/8 px-3 py-[8px]"
              >
                <span className="num w-[64px] shrink-0 text-right text-[13px] font-semibold">
                  {num(z.menge)}
                </span>
                <span className="w-[34px] shrink-0 text-[11.5px] text-faint">
                  {z.einheit}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {z.bezeichnung}
                </span>
                <span className="text-[11.5px] text-s-crit">
                  {z.liefertermin
                    ? `Lieferung ${date(z.liefertermin)}`
                    : "nicht bestellt"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {warteschlange ? (
        <p role="status" className="mt-3 text-[12.5px] text-s-done">
          {warteschlange}
        </p>
      ) : null}
      <Meldung status={hakenStatus} />
      <Meldung status={uebernahmeStatus} />

      <Serien block={block} touch={touch} />
      <Ruecklaeufer
        block={block}
        touch={touch}
        {...(touch ? { offline: offlineBuchen } : {})}
      />
    </section>
  );
}

/**
 * Seriennummern der Geräte, die auf diesen Vorgang gebucht wurden.
 *
 * Nicht blockierend: wer sie später nachträgt, kann laden. Der offene
 * Nachtrag bleibt als Hinweis stehen — die Nummer wird für Garantie und
 * Netzbetreibermeldung gebraucht, nur eben nicht in dieser Minute.
 */
function Serien({ block, touch }: { block: Block; touch: boolean }) {
  const [status, erfassen] = useActionState<AktionsStatus, FormData>(
    seriennummerErfassen,
    LEER,
  );
  const [offen, setOffen] = useState(false);

  const geraete = [...block.zuLaden, ...block.aufBaustelle].filter(
    (z) => z.seriennummernpflichtig,
  );
  if (geraete.length === 0) return null;

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setOffen(!offen)}
        className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-accent-ink underline"
      >
        Seriennummern erfassen ({geraete.length})
      </button>

      {offen ? (
        <div className="mt-2 flex flex-col gap-2">
          {geraete.map((g) => (
            <form
              key={`sn-${g.bedarfId}`}
              action={erfassen}
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="vorgangId" value={block.vorgangId} />
              <input type="hidden" name="artikelId" value={g.artikelId} />
              <span className="min-w-[130px] flex-1 truncate text-[12.5px]">
                {g.bezeichnung}
              </span>
              <input
                name="nummer"
                aria-label={`Seriennummer ${g.bezeichnung}`}
                placeholder="Seriennummer"
                className={`num rounded-input border border-line bg-surface px-[11px] outline-0 focus:border-accent ${
                  touch ? "min-h-[48px] text-[15px]" : "py-[7px] text-[13px]"
                }`}
              />
              <button
                type="submit"
                className="cursor-pointer rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] font-medium text-ink transition-colors hover:bg-sunk"
              >
                Vermerken
              </button>
            </form>
          ))}
          <Meldung status={status} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Rückläufer am Tagesende.
 *
 * Kommt in der Photovoltaik ständig vor: zwei Optimierer übrig, ein
 * angebrochenes Gebinde. Ohne diesen Weg bleiben sie auf dem Vorgang
 * stehen und verfälschen die Nachkalkulation.
 */
function Ruecklaeufer({
  block,
  touch,
  offline,
}: {
  block: Block;
  touch: boolean;
  /** In der Monteur-App über die Warteschlange, sonst direkt. */
  offline?: (
    art: "entnahme" | "rueckgabe",
    d: { artikelId: string; menge: number; bedarfId: string },
  ) => Promise<void>;
}) {
  const [status, zurueck] = useActionState<AktionsStatus, FormData>(
    rueckgabeErfassen,
    LEER,
  );
  const [offen, setOffen] = useState(false);

  const kandidaten = block.aufBaustelle.filter((z) => z.gebucht > 0);
  if (kandidaten.length === 0) return null;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setOffen(!offen)}
        className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-accent-ink underline"
      >
        Zurück ins Lager
      </button>

      {offen ? (
        <div className="mt-2 flex flex-col gap-2">
          {kandidaten.map((z) => (
            <form
              key={`rueck-${z.bedarfId}`}
              action={offline ? undefined : zurueck}
              onSubmit={
                offline
                  ? (e) => {
                      e.preventDefault();
                      const feld = e.currentTarget.elements.namedItem(
                        "menge",
                      ) as HTMLInputElement | null;
                      const menge = Number((feld?.value ?? "").replace(",", "."));
                      if (!Number.isFinite(menge) || menge <= 0) return;
                      void offline("rueckgabe", {
                        artikelId: z.artikelId,
                        menge,
                        bedarfId: z.bedarfId,
                      });
                    }
                  : undefined
              }
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="vorgangId" value={block.vorgangId} />
              <input type="hidden" name="artikelId" value={z.artikelId} />
              <span className="min-w-[130px] flex-1 truncate text-[12.5px]">
                {z.bezeichnung}
              </span>
              <input
                name="menge"
                type="number"
                step="0.001"
                min="0.001"
                max={z.gebucht}
                aria-label={`Rückgabe ${z.bezeichnung}`}
                className={`num w-[96px] rounded-input border border-line bg-surface px-[11px] text-right outline-0 focus:border-accent ${
                  touch ? "min-h-[48px] text-[15px]" : "py-[7px] text-[13px]"
                }`}
              />
              <button
                type="submit"
                className="cursor-pointer rounded-pill border border-line bg-surface px-[14px] py-[7px] text-[12.5px] font-medium text-ink transition-colors hover:bg-sunk"
              >
                Zurückbuchen
              </button>
            </form>
          ))}
          <Meldung status={status} />
        </div>
      ) : null}
    </div>
  );
}
