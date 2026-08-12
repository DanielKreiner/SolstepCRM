"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  alsVorgangUebernehmen,
  type PlanerState,
  uebergabeVorschau,
  type UebergabeVorschau,
} from "@/app/(app)/planer/actions";
import { num } from "@/lib/format";

/*
 * Übergabe der Planung an einen Vorgang (Briefing 8.2).
 *
 * Der Dialog zeigt ZUERST, was entstehen würde, und legt erst danach an.
 * Ein Knopf, der ungefragt einen Vorgang und eine halbe Bedarfsliste
 * erzeugt, ist im Betrieb nicht zu gebrauchen — die Liste geht in den
 * Einkauf, und was dort einmal steht, bestellt jemand.
 *
 * Beim zweiten Mal wird nicht überschrieben, sondern abgeglichen: die
 * Bedarfsliste gehört dem Betrieb, der Planer darf ihr etwas
 * vorschlagen.
 */

const LEER: PlanerState = { error: null, ok: null };

export interface KundeKurz {
  id: string;
  name: string;
  ort: string | null;
}

export function Uebergabe({
  projektId,
  kunden,
  schreibrecht,
  onVorOeffnen,
}: {
  projektId: string;
  kunden: KundeKurz[];
  schreibrecht: boolean;
  /** Ausstehende Änderungen sichern, bevor der Server den Plan liest. */
  onVorOeffnen: () => Promise<void>;
}) {
  const [offen, setOffen] = useState(false);
  const [vorschau, setVorschau] = useState<UebergabeVorschau | null>(null);
  const [laedt, laden] = useTransition();
  const [stand, uebernehmen, laeuft] = useActionState(alsVorgangUebernehmen, LEER);

  const [phase, setPhase] = useState<"anfrage" | "angebot">("anfrage");
  const [kundeId, setKundeId] = useState<string>("");
  const [suche, setSuche] = useState("");
  const [abgewaehlt, setAbgewaehlt] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!offen) return;
    laden(async () => {
      // Erst sichern, dann lesen — sonst zeigt der Dialog den Stand von
      // vor der letzten Änderung.
      await onVorOeffnen();
      setVorschau(await uebergabeVorschau(projektId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen, projektId, stand.ok]);

  if (!schreibrecht) return null;

  const treffer = suche.trim()
    ? kunden.filter((k) => k.name.toLowerCase().includes(suche.trim().toLowerCase())).slice(0, 6)
    : [];

  /*
   * Unveränderte Positionen stehen zur Übersicht in der Liste, sind
   * aber nicht auswählbar — es gibt nichts zu übernehmen.
   */
  const auswaehlbar = (vorschau?.positionen ?? []).filter((p) => p.art !== "unveraendert");
  const gewaehlt = auswaehlbar.filter((p) => !abgewaehlt.has(p.schluessel));

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="flex h-[52px] w-full items-center justify-center rounded-[14px] bg-accent px-4 text-[15px] font-bold text-white transition-colors hover:bg-accent-to"
      >
        Als Vorgang übernehmen
      </button>

      {offen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-card bg-panel shadow-soft sm:rounded-card">
            <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
              <h2 className="text-[18px] font-extrabold">
                {vorschau?.vorgangNummer
                  ? `Abgleich mit ${vorschau.vorgangNummer}`
                  : "Als Vorgang übernehmen"}
              </h2>
              <button
                type="button"
                onClick={() => setOffen(false)}
                aria-label="Schliessen"
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-[8px] text-[16px] text-muted hover:bg-sunk"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              {/*
                * Auf `!vorschau` prüfen, nicht auf `laedt`: zwischen dem
                * Öffnen und dem Start der Transition gibt es einen
                * Render, in dem beides falsch ist. Der Zweig darunter
                * griff dort mit `vorschau!` zu und riss die ganze Seite
                * mit einem Client-Fehler ab.
                */}
              {!vorschau ? (
                <p className="text-[13px] text-muted">Liest die Planung …</p>
              ) : vorschau.fehler ? (
                <p className="text-[13px] font-semibold text-s-crit">{vorschau.fehler}</p>
              ) : (
                <form action={uebernehmen} className="flex flex-col gap-4">
                  <input type="hidden" name="projektId" value={projektId} />
                  {gewaehlt.map((p) => (
                    <input key={p.schluessel} type="hidden" name="position" value={p.schluessel} />
                  ))}

                  {/* ── Kunde und Phase, nur beim ersten Mal ──────── */}
                  {!vorschau.vorgangId ? (
                    <>
                      <div>
                        <div className="text-[12px] font-semibold text-muted">Phase</div>
                        <div className="mt-1.5 flex gap-1.5">
                          {(["anfrage", "angebot"] as const).map((ph) => (
                            <button
                              key={ph}
                              type="button"
                              aria-pressed={phase === ph}
                              onClick={() => setPhase(ph)}
                              className={[
                                "rounded-[10px] border-[1.5px] px-3.5 py-2 text-[13px] font-semibold capitalize transition-colors",
                                phase === ph
                                  ? "border-accent bg-accent-sunk text-accent-ink"
                                  : "border-line bg-surface text-muted hover:border-line-strong",
                              ].join(" ")}
                            >
                              {ph}
                            </button>
                          ))}
                        </div>
                        <input type="hidden" name="phase" value={phase} />
                      </div>

                      <div>
                        <label htmlFor="uebergabe-kunde" className="mb-1 block text-[12px] font-semibold text-muted">
                          Kunde
                        </label>
                        <input
                          id="uebergabe-kunde"
                          value={suche}
                          onChange={(e) => {
                            setSuche(e.target.value);
                            setKundeId("");
                          }}
                          placeholder="Name suchen oder neu anlegen"
                          className="h-10 w-full rounded-[10px] border border-line bg-surface px-2.5 text-[13.5px] outline-none focus:border-line-strong"
                        />
                        <input type="hidden" name="kundeId" value={kundeId} />
                        <input type="hidden" name="kundeName" value={kundeId ? "" : suche} />

                        {treffer.length > 0 && !kundeId ? (
                          <ul className="mt-1.5 flex flex-col overflow-hidden rounded-[10px] border border-line">
                            {treffer.map((k) => (
                              <li key={k.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setKundeId(k.id);
                                    setSuche(k.name);
                                  }}
                                  className="flex w-full items-baseline gap-2 bg-surface px-3 py-2 text-left text-[13px] hover:bg-sunk"
                                >
                                  <span className="font-semibold">{k.name}</span>
                                  {k.ort ? <span className="text-[12px] text-muted">{k.ort}</span> : null}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        {suche.trim().length >= 2 && !kundeId ? (
                          <p className="mt-1.5 text-[12.5px] text-muted">
                            Kein bestehender Kunde gewählt — {"\u201E"}{suche.trim()}{"\u201C"} wird neu angelegt.
                          </p>
                        ) : null}
                      </div>

                      <div className="rounded-[10px] bg-sunk px-3 py-2.5 text-[13px] leading-[1.5] text-muted">
                        Der Vorgang bekommt {num(Math.round(vorschau.kwp * 100) / 100)} kWp
                        {vorschau.speicherKwh > 0
                          ? ` und ${num(vorschau.speicherKwh)} kWh Speicher`
                          : ""}{" "}
                        sowie die Adresse der Planung. Die Planung bleibt bestehen und ist vom
                        Vorgang aus erreichbar.
                      </div>
                    </>
                  ) : (
                    <div className="rounded-[10px] bg-sunk px-3 py-2.5 text-[13px] leading-[1.5] text-muted">
                      Diese Planung hängt schon an {vorschau.vorgangNummer}. Übernommen wird nur,
                      was hier angehakt ist — von Hand ergänzte Positionen bleiben unberührt.
                    </div>
                  )}

                  {/* ── Bedarfsliste ─────────────────────────────── */}
                  <div>
                    <div className="text-[13px] font-semibold">Bedarfsliste</div>
                    {vorschau.positionen.length === 0 ? (
                      <p className="mt-1.5 text-[13px] text-muted">
                        Aus dieser Planung ergibt sich noch kein Material — es liegen keine Module
                        auf dem Dach.
                      </p>
                    ) : (
                      <ul className="mt-1.5 flex flex-col divide-y divide-line border-y border-line">
                        {vorschau.positionen.map((p) => {
                          const an = !abgewaehlt.has(p.schluessel);
                          const wandelbar = p.art !== "unveraendert";
                          return (
                            <li key={p.schluessel} className="flex items-baseline gap-2.5 py-2.5">
                              <input
                                type="checkbox"
                                checked={wandelbar ? an : false}
                                disabled={!wandelbar}
                                aria-label={`${p.bezeichnung} übernehmen`}
                                onChange={() => {
                                  const n = new Set(abgewaehlt);
                                  if (an) n.add(p.schluessel);
                                  else n.delete(p.schluessel);
                                  setAbgewaehlt(n);
                                }}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-[13px] font-semibold">{p.bezeichnung}</div>
                                <div className="flex flex-wrap gap-x-2 text-[12.5px] text-muted">
                                  <Marke art={p.art} />
                                  {p.art === "geaendert" ? (
                                    <span className="num">
                                      {num(p.vorherigeMenge ?? 0)} → {num(p.menge)}
                                    </span>
                                  ) : null}
                                  {p.artikel_id === null && p.art !== "entfallen" ? (
                                    <span className="font-semibold text-s-warn">
                                      Artikel zuordnen
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="num shrink-0 text-[13px] font-semibold">
                                {num(p.menge)} Stk
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {stand.error ? (
                    <p className="text-[13px] font-semibold text-s-crit">{stand.error}</p>
                  ) : null}
                  {stand.ok ? (
                    <p className="text-[13px] font-semibold text-s-done">
                      {stand.ok}{" "}
                      {stand.id ? (
                        <Link href={`/vorgaenge/${stand.id}`} className="text-accent-ink hover:underline">
                          Vorgang öffnen
                        </Link>
                      ) : null}
                    </p>
                  ) : null}

                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={laeuft || (!vorschau?.vorgangId && !kundeId && suche.trim().length < 2)}
                      className="flex h-10 items-center rounded-[10px] bg-accent px-4 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-to disabled:opacity-50"
                    >
                      {laeuft
                        ? "Übernimmt …"
                        : vorschau?.vorgangId
                          ? `${gewaehlt.length} Änderung${gewaehlt.length === 1 ? "" : "en"} übernehmen`
                          : "Vorgang anlegen"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOffen(false)}
                      className="text-[13px] text-muted hover:text-ink"
                    >
                      abbrechen
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Marke({ art }: { art: string }) {
  const text =
    art === "neu"
      ? "neu"
      : art === "geaendert"
        ? "Menge geändert"
        : art === "entfallen"
          ? "entfällt"
          : "unverändert";
  const farbe =
    art === "neu"
      ? "text-s-done"
      : art === "geaendert"
        ? "text-s-warn"
        : art === "entfallen"
          ? "text-s-crit"
          : "text-muted";
  return <span className={`font-semibold ${farbe}`}>{text}</span>;
}
