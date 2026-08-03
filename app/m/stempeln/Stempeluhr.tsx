"use client";

import { useEffect, useState } from "react";
import { enqueue, flush } from "@/lib/offline/queue";

type Job = { id: string; number: string; customer: string };

type Props = {
  jobs: Job[];
  /** Laufender Eintrag laut Server beim Seitenaufruf. */
  laufendSeit: string | null;
  laufendJob: string | null;
};

const ARTEN = [
  ["work", "Arbeit"],
  ["travel", "Fahrt"],
  ["break", "Pause"],
] as const;

/*
 * Stempeluhr.
 *
 * Der laufende Timer läuft lokal weiter und wird beim Ausstempeln als Paar
 * übertragen (CLAUDE.md Abschnitt 8). Deshalb steht der Startzeitpunkt im
 * localStorage: ein Reload auf dem Dach darf die Schicht nicht verlieren.
 */
const KEY = "betrieb:laufend";

export function Stempeluhr({ jobs, laufendSeit, laufendJob }: Props) {
  const [seit, setSeit] = useState<string | null>(laufendSeit);
  const [jobId, setJobId] = useState<string>(laufendJob ?? jobs[0]?.id ?? "");
  const [art, setArt] = useState<string>("work");
  const [jetzt, setJetzt] = useState<number>(() => Date.now());
  const [meldung, setMeldung] = useState<string | null>(null);

  useEffect(() => {
    // Server gewinnt bei Stammdaten, der Client bei Zeitstempeln: ein lokal
    // gestarteter Timer überlebt einen Reload ohne Netz.
    const lokal = window.localStorage.getItem(KEY);
    if (!laufendSeit && lokal) setSeit(lokal);
    if (laufendSeit) window.localStorage.setItem(KEY, laufendSeit);
  }, [laufendSeit]);

  useEffect(() => {
    const t = window.setInterval(() => setJetzt(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const dauer = seit ? Math.max(0, jetzt - new Date(seit).getTime()) : 0;

  async function einstempeln() {
    const ts = new Date().toISOString();
    await enqueue("time_start", {
      jobId: jobId || null,
      kind: art,
      note: null,
    });
    setSeit(ts);
    window.localStorage.setItem(KEY, ts);
    setMeldung("Eingestempelt.");
    window.dispatchEvent(new Event("betrieb:queue"));
    void flush().then(() =>
      window.dispatchEvent(new Event("betrieb:queue")),
    );
  }

  async function ausstempeln() {
    await enqueue("time_stop", {});
    setSeit(null);
    window.localStorage.removeItem(KEY);
    setMeldung("Ausgestempelt.");
    window.dispatchEvent(new Event("betrieb:queue"));
    void flush().then(() =>
      window.dispatchEvent(new Event("betrieb:queue")),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[20px] bg-surface p-5 text-center shadow-soft">
        <p className="text-[12.5px] text-muted">
          {seit ? "Läuft seit" : "Nicht eingestempelt"}
        </p>
        <p className="num mt-1 text-[40px] leading-none font-semibold tracking-tight">
          {seit ? formatDauer(dauer) : "0:00:00"}
        </p>
        {seit ? (
          <p className="num mt-2 text-[12px] text-muted">
            seit{" "}
            {new Date(seit).toLocaleTimeString("de-AT", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : null}
      </div>

      {!seit ? (
        <>
          <div className="flex flex-col gap-[6px]">
            <label
              htmlFor="m-stempel-job"
              className="text-[12.5px] font-semibold text-muted"
            >
              Vorgang
            </label>
            <select
              id="m-stempel-job"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="min-h-[56px] w-full rounded-input border border-transparent bg-surface px-4 text-[15px] outline-0 focus:border-accent"
            >
              <option value="">— ohne Vorgang —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.number} · {j.customer}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            {ARTEN.map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setArt(v)}
                className={[
                  "min-h-[56px] flex-1 rounded-input text-[15px] font-medium transition-colors",
                  art === v
                    ? "bg-accent text-white"
                    : "bg-surface text-muted",
                ].join(" ")}
              >
                {l}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={seit ? ausstempeln : einstempeln}
        className={[
          "min-h-[64px] w-full cursor-pointer rounded-pill border-0 text-[17px] font-semibold text-white",
          seit
            ? "bg-s-crit"
            : "bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] shadow-[0_6px_18px_rgba(201,121,24,0.28)]",
        ].join(" ")}
      >
        {seit ? "Ausstempeln" : "Einstempeln"}
      </button>

      {meldung ? (
        <p role="status" className="text-center text-[13px] text-muted">
          {meldung}
        </p>
      ) : null}
    </div>
  );
}

function formatDauer(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sek = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sek).padStart(2, "0")}`;
}
