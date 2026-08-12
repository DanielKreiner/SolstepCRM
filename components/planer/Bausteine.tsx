"use client";

import { useState, type ReactNode } from "react";

/*
 * Bausteine des Planer-Panels.
 *
 * Ein Schritt stellt EINE Frage, und die Antwort ist ein grosser Knopf.
 * Alles, was ein Betrieb selten braucht — Randabstand, Reihenabstand,
 * Aufständerungswinkel —, liegt hinter „Mehr einstellen" und ist beim
 * Öffnen des Schritts nicht zu sehen.
 *
 * Der Grund steht im Gesprächsprotokoll: Die erste Fassung zeigte alles
 * gleichzeitig, in 12,5-px-Schrift, mit acht Karten untereinander. Wer
 * damit beim Kunden am Tisch sitzt, sucht statt zu planen.
 *
 * Masse: Knöpfe 52 px hoch (am iPad mit dem Daumen zu treffen),
 * Überschrift 20 px, Fliesstext 14 px. Keine Fläche unter 44 px.
 */

/** Die Frage, mit der ein Schritt anfängt. */
export function Frage({ text, hinweis }: { text: string; hinweis?: string | undefined }) {
  return (
    <div className="px-1 pb-1">
      <h2 className="text-[20px] font-extrabold leading-[1.2] tracking-[-0.01em]">{text}</h2>
      {hinweis ? <p className="mt-1.5 text-[13.5px] leading-[1.45] text-muted">{hinweis}</p> : null}
    </div>
  );
}

type KnopfArt = "haupt" | "zweit" | "still";

const KNOPF_ART: Record<KnopfArt, string> = {
  haupt: "bg-accent text-white hover:bg-accent-to disabled:bg-accent/40",
  zweit: "border border-line bg-surface text-ink hover:border-accent disabled:opacity-40",
  still: "text-muted hover:bg-sunk hover:text-ink disabled:opacity-40",
};

export function Knopf({
  children,
  onClick,
  art = "haupt",
  aus,
  titel,
  zeichen,
  voll = true,
}: {
  children: ReactNode;
  onClick: () => void;
  art?: KnopfArt;
  aus?: boolean;
  /*
   * Ausdrückliches `undefined`: Bei `exactOptionalPropertyTypes` ist
   * „Feld fehlt" nicht dasselbe wie „Feld ist undefined", und aus einem
   * Bedingungsausdruck kommt Letzteres.
   */
  titel?: string | undefined;
  zeichen?: ReactNode;
  voll?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={aus}
      title={titel}
      className={[
        "flex h-[52px] items-center justify-center gap-2.5 rounded-[14px] px-4",
        "text-[15px] font-bold transition-colors disabled:cursor-not-allowed",
        voll ? "w-full" : "",
        KNOPF_ART[art],
      ].join(" ")}
    >
      {zeichen}
      <span>{children}</span>
    </button>
  );
}

/**
 * Eine Karte zum Auswählen — Modul, Wechselrichter, Speicher.
 *
 * Als Karte und nicht als Auswahlliste: In einem `select` steht das
 * Gewählte in 13 px am Feldrand, und ob 440 oder 460 Wp eingestellt
 * sind, sieht man erst beim Aufklappen. Die Karte zeigt die Zahl, auf
 * die es ankommt, in Grösse.
 */
export function Wahlkarte({
  titel,
  zeile,
  gewaehlt,
  onClick,
  aus,
  kennung,
}: {
  titel: string;
  zeile: string;
  gewaehlt: boolean;
  onClick: () => void;
  aus?: boolean;
  /** Für Tests: macht die Karte auffindbar, ohne über den Namen zu raten. */
  kennung?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={aus}
      aria-pressed={gewaehlt}
      data-testid={kennung}
      className={[
        "flex w-full items-center gap-3 rounded-[14px] border px-3.5 py-3 text-left transition-colors",
        gewaehlt
          ? "border-accent bg-accent-sunk"
          : "border-line bg-surface hover:border-accent disabled:opacity-40",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2",
          gewaehlt ? "border-accent bg-accent text-white" : "border-line",
        ].join(" ")}
      >
        {gewaehlt ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7" />
          </svg>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold leading-tight">{titel}</span>
        <span className="num mt-0.5 block truncate text-[12.5px] tabular-nums text-muted">{zeile}</span>
      </span>
    </button>
  );
}

/** Zahleneingabe mit Einheit — 52 px hoch, Zahl in Monospace. */
export function Zahlfeld({
  label,
  wert,
  einheit,
  min,
  max,
  schritt = 1,
  onWert,
  aus,
}: {
  label: string;
  wert: number;
  einheit?: string;
  min?: number;
  max?: number;
  schritt?: number;
  onWert: (v: number) => void;
  aus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-muted">{label}</span>
      <span className="relative flex items-center">
        <input
          type="number"
          value={wert}
          min={min}
          max={max}
          step={schritt}
          disabled={aus}
          aria-label={label}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            if (min !== undefined && v < min) return;
            if (max !== undefined && v > max) return;
            onWert(v);
          }}
          className="num h-[52px] w-full rounded-[14px] border border-line bg-surface px-3.5 pr-12 text-[16px] font-bold tabular-nums outline-none focus:border-accent disabled:opacity-50"
        />
        {einheit ? (
          <span className="pointer-events-none absolute right-3.5 text-[13px] font-semibold text-muted">
            {einheit}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Was der Schritt schon erreicht hat — eine Zeile, gross gesetzt.
 *
 * Der Betrieb liest hier ab, ob er weitergehen kann. Deshalb nur EIN
 * Wert je Zeile und keine Tabelle.
 */
export function Stand({
  eintraege,
}: {
  eintraege: Array<{ label: string; wert: string; kennung?: string }>;
}) {
  if (eintraege.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-sunk px-3.5 py-3">
      {eintraege.map((e) => (
        <div key={e.label} className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-muted">{e.label}</span>
          <span data-testid={e.kennung} className="num text-[15px] font-bold tabular-nums">
            {e.wert}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Aufklappbarer Bereich für alles, was selten gebraucht wird. */
export function Mehr({ titel = "Mehr einstellen", children }: { titel?: string; children: ReactNode }) {
  const [offen, setOffen] = useState(false);
  return (
    <div className="rounded-[14px] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        aria-expanded={offen}
        className="flex h-[48px] w-full items-center justify-between px-3.5 text-[14px] font-bold"
      >
        {titel}
        {/*
          * Der Pfeil ist Dekoration und gehört nicht in den Namen des
          * Knopfes: Sonst heisst der Knopf „Mehr einstellen ▾", und
          * jede Suche nach seinem Namen geht daneben.
          */}
        <span
          aria-hidden="true"
          className={`text-[13px] text-muted transition-transform ${offen ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {offen ? <div className="flex flex-col gap-3 border-t border-line px-3.5 py-3.5">{children}</div> : null}
    </div>
  );
}

/** Auswahlzeile in einer Liste (Dachfläche, Modulfeld). */
export function Listenzeile({
  titel,
  wert,
  gewaehlt,
  onClick,
  onWeg,
  wegBeschriftung,
}: {
  titel: string;
  wert: string;
  gewaehlt: boolean;
  onClick: () => void;
  onWeg?: () => void;
  wegBeschriftung?: string;
}) {
  return (
    <div
      className={[
        "flex items-center gap-1 rounded-[12px] border pr-1 transition-colors",
        gewaehlt ? "border-accent bg-accent-sunk" : "border-line bg-surface",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex h-[48px] min-w-0 flex-1 items-center justify-between gap-2 px-3 text-left"
      >
        <span className="truncate text-[14px] font-semibold">{titel}</span>
        <span className="num shrink-0 text-[12.5px] tabular-nums text-muted">{wert}</span>
      </button>
      {onWeg ? (
        <button
          type="button"
          onClick={onWeg}
          /*
           * „Entfernen: Fläche 1" statt „Fläche 1 entfernen": Sonst
           * trägt der Löschknopf denselben Namensanfang wie die Zeile
           * selbst, und jede Suche nach „Fläche 1" findet zwei Knöpfe.
           */
          aria-label={wegBeschriftung ?? `Entfernen: ${titel}`}
          title={wegBeschriftung ?? `Entfernen: ${titel}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-sunk hover:text-s-crit"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9L17.5 7" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
