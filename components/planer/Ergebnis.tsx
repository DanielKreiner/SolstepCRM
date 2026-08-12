"use client";

import { num } from "@/lib/format";
import { MODELL, rechne, type WirtschaftErgebnis } from "@/lib/planer/wirtschaft";

/*
 * „Was die Anlage für dich rechnet" — die Ergebnisfläche der Phase 4
 * (Briefing 7, Aufbau nach Planer-HTML.html).
 *
 * Donut links, Jahresbilanz und die beiden grossen Zahlen rechts, die
 * 20-Jahre-Kurve darunter. Der Speicher-Toggle oben morpht alles auf
 * einmal — das ist der Moment, für den der ganze Bildschirm gebaut ist:
 * der Kunde sieht in einer Bewegung, was der Speicher bringt und was er
 * kostet.
 */

interface Props {
  ertragKwh: number;
  verbrauchKwh: number;
  speicherKwh: number;
  strompreis: number;
  verguetung: number;
  anlagenpreis: number;
  foerderung: number;
  steigerung: number;
  mitSpeicher: boolean;
  onMitSpeicher: (an: boolean) => void;
  /** Ohne PVGIS gerechnet — dann steht ein Hinweis an der Zahl. */
  geschaetzt: boolean;
  vorlaeufig: boolean;
  speicherVerfuegbar: boolean;
}

export function Ergebnis(p: Props) {
  const eingaben = {
    ertragKwh: p.ertragKwh,
    verbrauchKwh: p.verbrauchKwh,
    speicherKwh: p.mitSpeicher ? p.speicherKwh : 0,
    strompreis: p.strompreis,
    verguetung: p.verguetung,
    anlagenpreis: p.anlagenpreis,
    foerderung: p.foerderung,
    steigerung: p.steigerung,
  };
  const r = rechne(eingaben);

  if (p.ertragKwh <= 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-sm text-center text-[15px] leading-[1.55] text-muted">
          Noch keine Module belegt. Sobald auf dem Dach Module liegen, steht hier, was die Anlage
          bringt.
        </p>
      </div>
    );
  }

  const tilde = p.vorlaeufig ? "~" : "";

  return (
    /*
     * Oben 60 px Platz: Dort schwebt die Schrittleiste über dem Inhalt.
     * Ohne den Abstand lag sie auf der Überschrift.
     */
    <div className="h-full overflow-auto px-5 pb-4 pt-[60px]">
      <div className="flex flex-wrap items-center gap-3">
        {/*
          * Diese Seite liest der KUNDE mit — deshalb grösser als der
          * Rest der Anwendung. 24 px Überschrift, 40 px für die beiden
          * Zahlen, um die es geht.
          */}
        <h2 className="text-[24px] font-extrabold tracking-[-0.015em]">
          Was die Anlage für dich rechnet
        </h2>
        {p.geschaetzt ? (
          <span
            title="PVGIS war nicht erreichbar — gerechnet mit der mitgelieferten Tabelle."
            className="rounded-pill bg-sunk px-2.5 py-1 text-[11px] font-bold text-muted"
          >
            Ertrag geschätzt
          </span>
        ) : null}

        {p.speicherVerfuegbar ? (
          <div className="ml-auto flex gap-0.5 rounded-[10px] bg-sunk p-[3px]" role="group" aria-label="Speicher">
            <Umschalter an={!p.mitSpeicher} onClick={() => p.onMitSpeicher(false)}>
              ohne Speicher
            </Umschalter>
            <Umschalter an={p.mitSpeicher} onClick={() => p.onMitSpeicher(true)}>
              mit Speicher {num(Math.round(p.speicherKwh * 10) / 10)} kWh
            </Umschalter>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[236px_1fr]">
        <Donut autarkie={r.autarkie} />

        <div className="flex flex-col gap-3.5">
          <Jahresbilanz ergebnis={r} ertrag={p.ertragKwh} verbrauch={p.verbrauchKwh} tilde={tilde} />

          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="rounded-card bg-pl-flaeche px-5 py-4 text-pl-auf-dunkel">
              <div className="text-[13px] font-semibold text-pl-auf-dunkel-2">
                Amortisation{" "}
                <span title="Ab dann hat die Anlage ihren Preis wieder eingespielt." className="cursor-help">
                  ⓘ
                </span>
              </div>
              <div
                data-kennzahl="amortisation"
                className="num mt-1.5 whitespace-nowrap text-[32px] font-bold leading-none tracking-[-0.02em] text-accent"
              >
                {r.amortisationJahre === null
                  ? "—"
                  : `${tilde}${num(Math.round(r.amortisationJahre * 10) / 10)} Jahre`}
              </div>
            </div>

            <div className="rounded-card border border-line bg-surface px-5 py-4">
              <div className="text-[13px] font-semibold text-muted">
                Ersparnis im 1. Jahr{" "}
                <span title="Gesparter Netzstrom plus Einspeisevergütung." className="cursor-help text-muted/70">
                  ⓘ
                </span>
              </div>
              <div
                data-kennzahl="ersparnis"
                className="num mt-1.5 whitespace-nowrap text-[32px] font-bold leading-none tracking-[-0.02em]"
              >
                {tilde}
                {num(Math.round(r.ersparnisJahr1))} €
              </div>
            </div>
          </div>
        </div>
      </div>

      <Kurve ergebnis={r} steigerung={p.steigerung} />

      <p className="mt-3 text-[12.5px] leading-[1.5] text-muted">
        Richtwerte, unverbindlich. Das Modell rechnet mit Jahreswerten, nicht mit Lastprofilen —
        für ein Erstgespräch genau richtig, für die Netzanmeldung nicht.
      </p>
    </div>
  );
}

function Umschalter({
  an,
  onClick,
  children,
}: {
  an: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={an}
      className={[
        "flex h-[44px] items-center rounded-[10px] px-4 text-[13.5px] font-semibold transition-colors",
        an ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Donut({ autarkie }: { autarkie: number }) {
  const umfang = 2 * Math.PI * 64;
  const anteil = Math.max(0, Math.min(1, autarkie));
  return (
    <div className="flex flex-col items-center rounded-card border border-line bg-surface p-4">
      <svg width="150" height="150" viewBox="0 0 160 160" role="img" aria-label={`Autarkie ${Math.round(anteil * 100)} Prozent`}>
        <circle cx="80" cy="80" r="64" fill="none" stroke="var(--sunk)" strokeWidth="17" />
        <circle
          cx="80"
          cy="80"
          r="64"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="17"
          strokeLinecap="round"
          strokeDasharray={`${umfang * anteil} ${umfang}`}
          transform="rotate(-90 80 80)"
          style={{ transition: "stroke-dasharray .5s" }}
        />
        <text
          x="80"
          y="78"
          textAnchor="middle"
          className="num"
          fontSize="27"
          fontWeight="700"
          fill="var(--ink)"
          data-kennzahl="autarkie"
        >
          {Math.round(anteil * 100)} %
        </text>
        <text x="80" y="98" textAnchor="middle" fontSize="11" fill="var(--muted)">
          Autarkie
        </text>
      </svg>
      <div className="mt-2 flex gap-3 text-[12.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
          Eigener Strom
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-line-strong" />
          Netzbezug
        </span>
      </div>
      <p className="mt-2 text-center text-[12px] text-muted">
        Anteil des Verbrauchs vom eigenen Dach
      </p>
    </div>
  );
}

function Jahresbilanz({
  ergebnis,
  ertrag,
  verbrauch,
  tilde,
}: {
  ergebnis: WirtschaftErgebnis;
  ertrag: number;
  verbrauch: number;
  tilde: string;
}) {
  const netzbezug = Math.max(0, verbrauch - ergebnis.eigenverbrauchKwh);
  const balken = [
    { label: "Erzeugt", wert: ertrag, farbe: "var(--accent)" },
    { label: "Selbst genutzt", wert: ergebnis.eigenverbrauchKwh, farbe: "var(--accent)" },
    { label: "Eingespeist", wert: ergebnis.einspeisungKwh, farbe: "var(--line-strong)" },
    { label: "Aus dem Netz", wert: netzbezug, farbe: "var(--line-strong)" },
  ];
  const groesster = Math.max(...balken.map((b) => b.wert), 1);

  return (
    <div className="rounded-card border border-line bg-surface px-4.5 py-4">
      <div className="mb-3 text-[14px] font-bold">Jahresbilanz</div>
      {balken.map((b) => (
        <div key={b.label} className="mb-2 flex items-center gap-2.5 last:mb-0">
          <div className="w-[110px] shrink-0 text-[13px] text-muted">{b.label}</div>
          <div className="h-[15px] flex-1 overflow-hidden rounded-[6px] bg-sunk">
            <div
              className="h-full rounded-[6px] transition-[width] duration-500"
              style={{ width: `${(b.wert / groesster) * 100}%`, background: b.farbe }}
            />
          </div>
          <div className="num w-[96px] shrink-0 text-right text-[13px] font-semibold">
            {tilde}
            {num(Math.round(b.wert))} kWh
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Die kumulierte Ersparnis über zwanzig Jahre.
 *
 * Gezeichnet wird die Ersparnis, nicht der Saldo — die Investition
 * liegt als gestrichelte Linie darüber. So sieht man den Break-even als
 * Schnittpunkt und nicht als Nulldurchgang irgendwo in der Mitte.
 */
function Kurve({ ergebnis, steigerung }: { ergebnis: WirtschaftErgebnis; steigerung: number }) {
  const B = 640;
  const H = 170;
  const oben = 18;
  const unten = 152;

  const kumuliert = ergebnis.kurve.map((k) => k + ergebnis.investition);
  const hoechster = Math.max(...kumuliert, ergebnis.investition, 1);
  const y = (wert: number) => unten - (wert / hoechster) * (unten - oben);
  const x = (jahr: number) => (jahr / MODELL.jahre) * B;

  const punkte = kumuliert.map((wert, i) => `${x(i + 1).toFixed(1)},${y(wert).toFixed(1)}`);
  const linie = `M0,${y(0).toFixed(1)} L${punkte.join(" L")}`;
  const flaeche = `${linie} L${B},${unten} L0,${unten} Z`;
  const investY = y(ergebnis.investition);

  const be = ergebnis.breakEvenJahr;
  const beX = be === null ? null : x(be);

  return (
    <div className="mt-3.5 rounded-card border border-line bg-surface px-4.5 py-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="text-[13px] font-bold">Ersparnis über 20 Jahre</div>
        <div className="ml-auto text-[11px] text-muted">
          kumuliert, mit Strompreis +{num(steigerung * 100)} %/Jahr
        </div>
      </div>
      <svg viewBox={`0 0 ${B} ${H}`} className="mt-2 w-full" role="img" aria-label="Kumulierte Ersparnis über zwanzig Jahre">
        <path d={flaeche} fill="var(--accent)" opacity="0.16" />
        <path d={linie} fill="none" stroke="var(--accent)" strokeWidth="2.5" />

        <line x1="0" y1={investY} x2={B} y2={investY} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="6 5" />
        <text x={B - 4} y={investY - 5} textAnchor="end" className="num" fontSize="10" fill="var(--muted)">
          Anlagenpreis {num(Math.round(ergebnis.investition))} €
        </text>

        {beX !== null ? (
          <>
            <line x1={beX} y1={oben} x2={beX} y2={unten} stroke="var(--ink)" strokeWidth="1.5" />
            <circle cx={beX} cy={investY} r="4.5" fill="var(--ink)" />
            <text
              x={beX > B / 2 ? beX - 6 : beX + 6}
              y="14"
              textAnchor={beX > B / 2 ? "end" : "start"}
              className="num"
              fontSize="11"
              fontWeight="600"
              fill="var(--ink)"
            >
              Break-even: Jahr {be}
            </text>
          </>
        ) : (
          <text x="8" y="14" className="num" fontSize="11" fill="var(--muted)">
            Break-even liegt jenseits von 20 Jahren
          </text>
        )}

        <text x="4" y={H - 6} className="num" fontSize="10" fill="var(--muted)">
          heute
        </text>
        <text x={B - 4} y={H - 6} textAnchor="end" className="num" fontSize="10" fill="var(--muted)">
          20 Jahre
        </text>
      </svg>
    </div>
  );
}
