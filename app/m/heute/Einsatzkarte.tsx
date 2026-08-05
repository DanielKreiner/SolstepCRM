"use client";

import { useActionState, useEffect, useState } from "react";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Pill } from "@/components/ui/Pill";
import { ohneEinsatzStarten, zeitStarten, zeitStoppen } from "./actions";

export type Einsatz = {
  id: string;
  art: string;
  titel: string;
  vonZeit: string;
  bisZeit: string;
  adresse: string | null;
  kunde: string | null;
  kontakt: string | null;
  telefon: string | null;
  /** Was der Planer dazugeschrieben hat — Zufahrt, Schlüssel, Hund. */
  notiz: string | null;
  team: string[];
  vorgangId: string | null;
  /** Wie viele Positionen die Beladeliste für diesen Vorgang zeigt. */
  zuLaden: number;
  fehlt: number;
  lieferungen: number;
};

const ART: Record<string, string> = {
  auftrag: "Montage",
  service: "Service",
  intern: "Intern",
};

/**
 * Der Einsatz von heute — und der Knopf, der die Zeit startet.
 *
 * Der Knopf sitzt auf der Karte und nicht auf einer eigenen Seite: eine
 * Uhr ohne Baustelle daneben erzeugt Zeiten, die niemandem gehören. Wer
 * um halb sieben im Auto sitzt, tippt einmal — und die Zeit hängt am
 * richtigen Auftrag.
 */
export function Einsatzkarte({
  einsatz,
  laeuftSeit,
  laeuftHier,
}: {
  einsatz: Einsatz;
  laeuftSeit: string | null;
  laeuftHier: boolean;
}) {
  const [startStatus, starten] = useActionState<AktionsStatus, FormData>(
    zeitStarten,
    LEER,
  );
  const [stoppStatus, stoppen] = useActionState<AktionsStatus, FormData>(
    zeitStoppen,
    LEER,
  );

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Pill tone={einsatz.art === "service" ? "waiting" : "doing"}>
          {ART[einsatz.art] ?? einsatz.art}
        </Pill>
        <span className="num text-[13px] font-semibold">
          {einsatz.vonZeit}–{einsatz.bisZeit}
        </span>
      </div>

      <h2 className="text-[19px] leading-tight font-bold tracking-[-0.01em]">
        {einsatz.kunde ?? einsatz.titel}
      </h2>

      {einsatz.adresse ? (
        <a
          href={`https://maps.apple.com/?q=${encodeURIComponent(einsatz.adresse)}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block text-[14px] text-accent-ink underline"
        >
          {einsatz.adresse}
        </a>
      ) : null}

      {einsatz.kontakt || einsatz.telefon ? (
        <p className="mt-2 text-[13.5px]">
          {einsatz.kontakt}
          {einsatz.telefon ? (
            <>
              {einsatz.kontakt ? " · " : ""}
              <a href={`tel:${einsatz.telefon}`} className="text-accent-ink underline">
                {einsatz.telefon}
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {/*
        Die Notiz stand bisher in der Planung und kam nie an. Genau die
        Sätze, die niemand zweimal erklärt — „Schlüssel beim Nachbarn",
        „Zufahrt über den Hof" — sind die, die den Monteur sonst zum
        Telefon greifen lassen.
      */}
      {einsatz.notiz ? (
        <p className="mt-2 rounded-input bg-sunk px-3 py-2 text-[13.5px]">
          {einsatz.notiz}
        </p>
      ) : null}

      {einsatz.team.length > 0 ? (
        <p className="mt-1 text-[12.5px] text-muted">
          Mit dabei: {einsatz.team.join(", ")}
        </p>
      ) : null}

      {/* ------------------------------------------------ STEMPELN */}
      <div className="mt-4">
        {laeuftHier ? (
          <StoppKnopf seit={laeuftSeit!} stoppen={stoppen} status={stoppStatus} />
        ) : (
          <form action={starten}>
            <input type="hidden" name="einsatzId" value={einsatz.id} />
            <button
              type="submit"
              data-testid={`zeit-starten-${einsatz.id}`}
              disabled={Boolean(laeuftSeit)}
              className={[
                "min-h-[56px] w-full rounded-pill border-0 px-6 text-[16px] font-semibold",
                laeuftSeit
                  ? "cursor-not-allowed bg-sunk text-faint"
                  : "cursor-pointer bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-white",
              ].join(" ")}
            >
              {laeuftSeit ? "Andere Zeit läuft" : "Zeit starten"}
            </button>
          </form>
        )}
        <Meldung status={startStatus} />
      </div>

      {/* ------------------------------------------------- MATERIAL */}
      {einsatz.vorgangId ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <a
            href="/m/material"
            className="rounded-pill border border-line bg-panel px-[16px] py-[10px] text-[13.5px] font-semibold text-ink"
          >
            Beladeliste
          </a>
          {einsatz.zuLaden > 0 ? (
            <Pill tone="doing">{einsatz.zuLaden} zu laden</Pill>
          ) : null}
          {einsatz.fehlt > 0 ? <Pill tone="crit">{einsatz.fehlt} fehlt</Pill> : null}
          {einsatz.lieferungen > 0 ? (
            <Pill tone="waiting">{einsatz.lieferungen} Lieferung erwartet</Pill>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Der laufende Zähler.
 *
 * Er läuft im Browser weiter, damit man sieht, dass die Zeit wirklich
 * läuft — auf einem Dach ohne Netz ist das der einzige Beweis.
 */
function StoppKnopf({
  seit,
  stoppen,
  status,
}: {
  seit: string;
  stoppen: (formData: FormData) => void;
  status: AktionsStatus;
}) {
  const [jetzt, setJetzt] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setJetzt(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const dauer = Math.max(0, jetzt - new Date(seit).getTime());
  const kurz = status.error?.includes("Verwerfen oder trotzdem speichern");

  return (
    <div>
      <p className="num mb-2 text-center text-[34px] leading-none font-semibold tracking-tight">
        {formatDauer(dauer)}
      </p>

      {kurz ? (
        <>
          <p className="mb-2 rounded-input bg-s-warn/14 px-4 py-3 text-[13px] text-accent-ink">
            {status.error}
          </p>
          <div className="flex gap-2">
            <form action={stoppen} className="flex-1">
              <input type="hidden" name="verwerfen" value="ja" />
              <button
                type="submit"
                data-testid="zeit-verwerfen"
                className="min-h-[56px] w-full cursor-pointer rounded-pill border border-line bg-surface text-[15px] font-semibold text-ink"
              >
                Verwerfen
              </button>
            </form>
            <form action={stoppen} className="flex-1">
              <input type="hidden" name="trotzdem" value="ja" />
              <button
                type="submit"
                data-testid="zeit-trotzdem"
                className="min-h-[56px] w-full cursor-pointer rounded-pill border-0 bg-ink text-[15px] font-semibold text-app"
              >
                Speichern
              </button>
            </form>
          </div>
        </>
      ) : (
        <form action={stoppen}>
          <button
            type="submit"
            data-testid="zeit-stoppen"
            className="min-h-[56px] w-full cursor-pointer rounded-pill border-0 bg-ink px-6 text-[16px] font-semibold text-app"
          >
            Zeit stoppen
          </button>
        </form>
      )}

      {!kurz ? <Meldung status={status} /> : null}
    </div>
  );
}

function formatDauer(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * Arbeit, die nicht geplant war.
 *
 * Der Knopf erzwingt eine Wahl: bestehender Einsatz oder ein Grund. Es
 * entsteht dabei immer ein Einsatz — eine Zeit ohne Einsatz kann es im
 * System nicht geben.
 */
export function OhnePlan({
  einsaetze,
  gesperrt,
}: {
  einsaetze: { id: string; label: string }[];
  gesperrt: boolean;
}) {
  const [status, starten] = useActionState<AktionsStatus, FormData>(
    ohneEinsatzStarten,
    LEER,
  );
  const [offen, setOffen] = useState(false);

  if (!offen) {
    return (
      <div>
        <button
          type="button"
          data-testid="ohne-plan-oeffnen"
          disabled={gesperrt}
          onClick={() => setOffen(true)}
          className={[
            "min-h-[52px] w-full rounded-pill border border-line bg-surface px-6 text-[14.5px] font-semibold",
            gesperrt ? "cursor-not-allowed text-faint" : "cursor-pointer text-ink",
          ].join(" ")}
        >
          Zeit ohne Einsatz starten
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <h2 className="text-[16px] font-semibold">Woran arbeitest du?</h2>
      <p className="mt-1 mb-3 text-[13px] text-muted">
        Such dir einen Einsatz oder sag kurz, worum es geht.
      </p>

      {einsaetze.length > 0 ? (
        <div className="mb-3 flex flex-col gap-2">
          {einsaetze.map((e) => (
            <form key={e.id} action={starten}>
              <input type="hidden" name="einsatzId" value={e.id} />
              <button
                type="submit"
                className="min-h-[52px] w-full cursor-pointer rounded-card border border-line bg-panel px-4 text-left text-[14px] font-medium text-ink"
              >
                {e.label}
              </button>
            </form>
          ))}
        </div>
      ) : null}

      <form action={starten} className="flex flex-col gap-2">
        <input
          name="grund"
          data-testid="ohne-plan-grund"
          placeholder="z. B. Lager aufräumen, Werkstatt"
          className="min-h-[52px] w-full rounded-input border border-line bg-surface px-[14px] text-[15px] outline-0 focus:border-accent"
        />
        <button
          type="submit"
          data-testid="ohne-plan-starten"
          className="min-h-[56px] w-full cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[16px] font-semibold text-white"
        >
          Zeit starten
        </button>
        <button
          type="button"
          onClick={() => setOffen(false)}
          className="min-h-[44px] cursor-pointer border-0 bg-transparent text-[13px] text-muted underline"
        >
          Abbrechen
        </button>
        <Meldung status={status} />
      </form>
    </section>
  );
}
