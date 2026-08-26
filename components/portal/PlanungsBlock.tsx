import type { PortalDetail } from "@/lib/portal/vorgang";

/*
 * Die Planung im Kundenportal.
 *
 * Der Aufbau folgt der Vorlage, die der Betrieb vorgegeben hat: ein
 * modernistisches Blatt statt einer Kachelsammlung. Was das ausmacht,
 * sind vier Entscheidungen, die überall gelten —
 *
 *   1. Keine Rundungen, keine Schatten. Getrennt wird durch Linien und
 *      Luft. Ein Angebot ist kein Dashboard.
 *   2. Überschriften gross und schwer, mit einem kleinen Versal-Label
 *      darüber, das sagt, in welchem Kapitel man ist.
 *   3. Kennzahlen stehen unter einer Haarlinie, nicht in einem Kasten.
 *      Die erste Zahl trägt die Akzentfarbe — sonst keine.
 *   4. Zahlen sind gross genug, um über den Tisch gelesen zu werden.
 *
 * Bewusst ohne Diagrammbibliothek: die Balken sind divs, der Sankey
 * sind sechs SVG-Pfade. Alles andere wäre ein halbes Megabyte
 * JavaScript für Bilder, die sich nicht bewegen.
 */

const MONATE = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function n(wert: number, stellen = 0): string {
  return wert.toLocaleString("de-AT", {
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  });
}

function eur(wert: number, stellen = 2): string {
  return `${n(wert, stellen)} €`;
}

function himmelsrichtung(azimut: number): string {
  const namen = ["Nord", "Nord-Ost", "Ost", "Süd-Ost", "Süd", "Süd-West", "West", "Nord-West"];
  return namen[Math.round((((azimut % 360) + 360) % 360) / 45) % 8]!;
}

/* ── Bausteine ────────────────────────────────────────────────────── */

/** Das kleine Versal-Label über einer Überschrift. */
function Kapitel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11.5px] font-bold tracking-[0.14em] text-faint uppercase">
      {children}
    </p>
  );
}

/** Die grosse Überschrift eines Abschnitts. */
function Titel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[30px] leading-[1.05] font-extrabold tracking-[-0.035em] sm:text-[38px]">
      {children}
    </h3>
  );
}

/** Zwischenüberschrift in Versalien — gliedert innerhalb eines Kapitels. */
function Zwischen({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[15px] font-extrabold tracking-[0.04em] uppercase">{children}</h4>
  );
}

/**
 * Eine Kennzahl unter einer Haarlinie.
 *
 * Die Linie trägt die Zahl, nicht ein Rahmen um sie herum. Genau eine
 * Kennzahl je Reihe darf die Akzentfarbe haben; mehr, und keine sticht
 * mehr heraus.
 */
function Kennzahl({
  zahl,
  label,
  akzent = false,
}: {
  zahl: string;
  label: string;
  akzent?: boolean;
}) {
  return (
    <div className={`border-t-2 pt-4 ${akzent ? "border-accent" : "border-ink"}`}>
      <p
        /*
         * Hier ausdrücklich NICHT die Monoschrift.
         *
         * Sonst reisst die Ziffernsperrung die Zahl auseinander, und aus
         * „1 322 €" wird ein Wort mit Lücken. Für Tabellen und Listen
         * bleibt die Monoschrift richtig — für Schaustücke nicht.
         */
        className={[
          "text-[26px] leading-none font-extrabold tracking-[-0.04em] tabular-nums sm:text-[32px]",
          akzent ? "text-accent-ink" : "",
        ].join(" ")}
      >
        {zahl}
      </p>
      <p className="mt-2.5 text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">
        {label}
      </p>
    </div>
  );
}

/** Eine Zeile in einer Werteliste: Label links, Wert rechts, Linie darunter. */
function Zeile({
  k,
  v,
  unter,
}: {
  k: string;
  v: string;
  unter?: string | null;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-line py-3.5 last:border-b-0">
      <span className="w-[38%] shrink-0 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
        {k}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug font-bold">{v}</span>
        {unter ? <span className="mt-0.5 block text-[12.5px] text-muted">{unter}</span> : null}
      </span>
    </div>
  );
}

/** Ein Anteilsband mit Prozentzahl, darunter die Erklärung. */
function Anteile({
  teile,
}: {
  teile: Array<{ wert: number; klasse: string; name: string }>;
}) {
  const gesamt = teile.reduce((a, t) => a + Math.max(0, t.wert), 0) || 1;
  return (
    <>
      <div className="mt-3 flex h-[44px] w-full">
        {teile.map((t) => (
          <div
            key={t.name}
            className={t.klasse}
            style={{ width: `${(Math.max(0, t.wert) / gesamt) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex">
        {teile.map((t) => (
          <div
            key={t.name}
            className="min-w-0 pr-3"
            style={{ width: `${(Math.max(0, t.wert) / gesamt) * 100}%` }}
          >
            <p className="num text-[12.5px] font-bold tabular-nums">
              {Math.round((Math.max(0, t.wert) / gesamt) * 100)} %
            </p>
            <p className="truncate text-[12.5px]">{t.name}</p>
            <p className="num truncate text-[12px] tabular-nums text-muted">
              {n(Math.round(t.wert))} kWh
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Der Energiefluss als Sankey.
 *
 * Sechs Bänder, deren Breite die Strommenge ist — links das Dach,
 * rechts Haushalt und Netz. Ein Diagramm, das man ohne Legende
 * versteht: dick ist viel.
 */
function Sankey({
  produktion,
  direkt,
  speicher,
  einspeisung,
  netzbezug,
  verbrauch,
}: {
  produktion: number;
  direkt: number;
  speicher: number;
  einspeisung: number;
  netzbezug: number;
  verbrauch: number;
}) {
  const H = 320;
  const B = 1000;
  const links = 10;
  const rechts = B - 10;
  const stab = 10;

  /* Massstab: die grössere der beiden Seiten füllt die Höhe. */
  const gesamt = Math.max(produktion, verbrauch + einspeisung, 1);
  const px = (kwh: number) => (Math.max(0, kwh) / gesamt) * H;

  /* Links stapeln sich die drei Wege aus der Produktion. */
  const hDirekt = px(direkt);
  const hSpeicher = px(speicher);
  const hEinspeisung = px(einspeisung);
  const hNetzbezug = px(netzbezug);

  let y = 0;
  const aus = { direkt: y, speicher: (y += hDirekt), einspeisung: (y += hSpeicher) };
  const ausNetzbezug = aus.einspeisung + hEinspeisung;

  /* Rechts oben der Haushalt, darunter das Netz. */
  let z = 0;
  const ein = { direkt: z, speicher: (z += hDirekt), netzbezug: (z += hSpeicher) };
  const einNetz = ein.netzbezug + hNetzbezug;

  const band = (y1: number, y2: number, h: number, farbe: string, deckung = 0.9) => {
    const x1 = links + stab;
    const x2 = rechts - stab;
    const m = (x1 + x2) / 2;
    return (
      <path
        d={`M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2} L${x2},${y2 + h} C${m},${y2 + h} ${m},${y1 + h} ${x1},${y1 + h} Z`}
        fill={farbe}
        fillOpacity={deckung}
      />
    );
  };

  return (
    <svg viewBox={`0 0 ${B} ${H}`} className="mt-4 h-auto w-full" role="img" aria-label="Energiefluss">
      {/* Die Bänder zuerst, damit die Stäbe darüber liegen. */}
      {band(aus.direkt, ein.direkt, hDirekt, "var(--accent)")}
      {band(aus.speicher, ein.speicher, hSpeicher, "#2E2C27", 0.82)}
      {band(aus.einspeisung, einNetz, hEinspeisung, "#B4B3A8", 0.6)}
      {band(ausNetzbezug, ein.netzbezug, hNetzbezug, "#8E93A1", 0.75)}

      {/* Stäbe links und rechts. */}
      <rect x={links} y={0} width={stab} height={hDirekt + hSpeicher + hEinspeisung} fill="var(--accent)" />
      <rect x={links} y={ausNetzbezug} width={stab} height={hNetzbezug} fill="#8E93A1" />
      <rect x={rechts - stab} y={0} width={stab} height={hDirekt + hSpeicher + hNetzbezug} fill="#2E2C27" />
      <rect x={rechts - stab} y={einNetz} width={stab} height={hEinspeisung} fill="#B4B3A8" />
    </svg>
  );
}

/* ── Der Block ────────────────────────────────────────────────────── */

export function PlanungsBlock({
  planung,
  kunde,
}: {
  planung: NonNullable<PortalDetail["planung"]>;
  /** Vorname für die Anrede in der Überschrift — „Roman, du sparst …". */
  kunde?: string;
}) {
  const hoechst = Math.max(...planung.fluss.monate.map((m) => m.produktion), 1);
  const jahr = new Date().getFullYear() + 1;

  const kurveHoch = Math.max(...planung.kurve, 0);
  const kurveTief = Math.min(...planung.kurve, 0);
  const kurveSpanne = kurveHoch - kurveTief || 1;
  const bezahltJahr =
    planung.amortisationJahre !== null
      ? jahr + Math.max(0, Math.round(planung.amortisationJahre) - 1)
      : null;

  return (
    <section className="mb-6 bg-surface px-5 py-9 sm:px-9 sm:py-12">
      {/* ── Dein Ergebnis ──────────────────────────────────────── */}
      <Kapitel>Dein Ergebnis</Kapitel>
      {planung.ersparnisJahr1 > 0 ? (
        <h2 className="max-w-[16ch] text-[42px] leading-[0.98] font-extrabold tracking-[-0.045em] sm:text-[68px]">
          {kunde ? `${kunde.split(" ")[0]}, du ` : "Du "}sparst rund{" "}
          <span className="text-accent-ink">{n(Math.round(planung.ersparnisJahr1))} €</span> im
          Jahr.
        </h2>
      ) : (
        <h2 className="text-[42px] leading-[0.98] font-extrabold tracking-[-0.045em] sm:text-[68px]">
          Deine Anlage im Detail.
        </h2>
      )}

      <p className="mt-6 max-w-[58ch] text-[16px] leading-[1.6] text-muted">
        Gerechnet mit deinem Verbrauch, {n(Math.round(planung.jahresertragKwh))} kWh Ertrag und{" "}
        {Math.round(planung.autarkie * 100)} % Autarkie
        {planung.speicherKwh > 0
          ? ` — mit ${n(Math.round(planung.speicherKwh * 10) / 10, 1)} kWh Speicher`
          : " — ohne Speicher"}
        . Über zwanzig Jahre sind das rund {n(Math.round(planung.ersparnis20))} €
        {planung.amortisationJahre !== null
          ? `; die Anlage hat sich nach etwa ${n(Math.round(planung.amortisationJahre * 10) / 10, 1)} Jahren bezahlt.`
          : "."}
      </p>
      <p className="mt-4 max-w-[58ch] text-[12.5px] leading-[1.5] text-faint">
        Richtwerte aus der Planung — der tatsächliche Ertrag hängt vom Wetter ab, die Ersparnis
        vom Strompreis. Steigt er, wird die Rechnung besser.
      </p>

      <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
        <Kennzahl zahl={`${n(planung.kwp, 2)} kWp`} label="Anlagenleistung" />
        <Kennzahl zahl={n(planung.modulAnzahl)} label="Module auf dem Dach" />
        {planung.speicherKwh > 0 ? (
          <Kennzahl
            zahl={`${n(Math.round(planung.speicherKwh * 10) / 10, 1)} kWh`}
            label="Speicher"
          />
        ) : null}
        <Kennzahl
          zahl={`${n(Math.round(planung.jahresertragKwh))} kWh`}
          label="Ertrag im Jahr"
          akzent
        />
      </div>

      {/* ── Deine Anlage ───────────────────────────────────────── */}
      <hr className="my-12 border-t border-ink/25" />
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <Kapitel>Deine Anlage</Kapitel>
          <Titel>Was verbaut wird</Titel>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.6] text-muted">
            Das ist die Anlage, die wir für dich geplant haben — so liegt sie auf deinem Dach,
            und das steckt darin.
          </p>

          <div className="mt-7 border-t border-ink">
            {planung.modulTyp ? (
              <Zeile k={`Module (${n(planung.modulAnzahl)} Stück)`} v={planung.modulTyp} />
            ) : null}
            {planung.wechselrichter ? (
              <Zeile k="Wechselrichter" v={planung.wechselrichter} />
            ) : null}
            {planung.speicherKwh > 0 ? (
              <Zeile
                k="Speicher"
                v={[
                  planung.speicher,
                  planung.speicherModule ? `${planung.speicherModule} Module` : null,
                  `${n(Math.round(planung.speicherKwh * 10) / 10, 1)} kWh`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ) : null}
            {planung.flaechen
              .filter((f) => f.module > 0)
              .map((f) => (
                <Zeile
                  key={f.name}
                  k={f.name}
                  v={`${n(f.module)} Module · ${n(f.neigung)}° · ${himmelsrichtung(f.azimut)}`}
                />
              ))}
          </div>

          <p className="mt-5 max-w-[46ch] text-[12.5px] leading-[1.55] text-faint">
            Die Belegung zeigt den geplanten Stand. Was vor Ort möglich ist, stellen wir bei der
            Aufnahme fest und besprechen es vorher mit dir.
          </p>
        </div>

        <div>
          {planung.bildUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- signierter Link, 15 Minuten gültig */}
              <img
                src={planung.bildUrl}
                alt="Das geplante Dach mit den Modulen"
                className="h-[300px] w-full object-cover sm:h-[420px]"
              />
              <p className="mt-2.5 text-[12.5px] text-muted">
                {planung.flaechen.find((f) => f.module > 0)?.name ?? "Dachfläche"} · geplante
                Belegung
              </p>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Dein Strom ─────────────────────────────────────────── */}
      <hr className="my-12 border-t border-ink/25" />
      <Kapitel>Dein Strom</Kapitel>
      <Titel>Monat für Monat</Titel>
      <p className="mt-4 max-w-[60ch] text-[15px] leading-[1.6] text-muted">
        {n(Math.round(planung.jahresertragKwh))} kWh im Jahr, das sind{" "}
        {n(Math.round(planung.spezifisch))} kWh je kWp — gerechnet aus Ausrichtung, Neigung und
        Verschattung deines Dachs. Die Farben zeigen, was direkt ins Haus geht, was über den
        Speicher läuft und was eingespeist wird.
      </p>

      <div className="mt-8 flex h-[240px] items-end gap-[6px] sm:gap-[10px]">
        {planung.fluss.monate.map((m, i) => (
          <div key={MONATE[i]} className="flex h-full flex-1 flex-col justify-end">
            <p className="mb-1.5 text-center text-[11px] tabular-nums text-muted">
              {n(Math.round(m.produktion))}
            </p>
            <div
              className="flex w-full flex-col justify-end"
              style={{ height: `${(m.produktion / hoechst) * 100}%` }}
            >
              <div
                className="w-full bg-[#D7D3D3]"
                style={{ height: `${(m.einspeisung / (m.produktion || 1)) * 100}%` }}
              />
              <div
                className="w-full bg-ink"
                style={{ height: `${(m.speicher / (m.produktion || 1)) * 100}%` }}
              />
              <div
                className="w-full bg-accent"
                style={{ height: `${(m.direkt / (m.produktion || 1)) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[6px] border-t border-ink pt-2 sm:gap-[10px]">
        {MONATE.map((mo) => (
          <span key={mo} className="flex-1 text-center text-[11.5px] text-muted">
            {mo}
          </span>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-x-7 gap-y-2">
        {[
          ["Direkt verbraucht", "bg-accent"],
          ["Über den Speicher", "bg-ink"],
          ["Ins Netz", "bg-[#D7D3D3]"],
        ].map(([text, klasse]) => (
          <span key={text} className="flex items-center gap-2 text-[12.5px]">
            <span className={`h-3 w-3 ${klasse}`} />
            {text}
          </span>
        ))}
      </div>

      {/* Wohin / Woher */}
      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <div>
          <Zwischen>Wohin geht dein Strom?</Zwischen>
          <p className="mt-1.5 text-[13px] text-muted">
            Von {n(Math.round(planung.jahresertragKwh))} kWh Erzeugung bleiben{" "}
            {Math.round(planung.eigenverbrauchQuote * 100)} % im Haus.
          </p>
          <Anteile
            teile={[
              { wert: planung.fluss.direktKwh, klasse: "bg-accent", name: "Direkt" },
              { wert: planung.fluss.ueberSpeicherKwh, klasse: "bg-ink", name: "Speicher" },
              { wert: planung.fluss.einspeisungKwh, klasse: "bg-[#D7D3D3]", name: "Ins Netz" },
            ]}
          />
        </div>
        <div>
          <Zwischen>Woher kommt dein Strom?</Zwischen>
          <p className="mt-1.5 text-[13px] text-muted">
            Dein Haushalt braucht {n(Math.round(planung.verbrauchKwh))} kWh im Jahr.
          </p>
          <Anteile
            teile={[
              { wert: planung.fluss.direktKwh, klasse: "bg-accent", name: "Vom Dach" },
              { wert: planung.fluss.ueberSpeicherKwh, klasse: "bg-ink", name: "Aus dem Speicher" },
              { wert: planung.fluss.netzbezugKwh, klasse: "bg-[#D7D3D3]", name: "Aus dem Netz" },
            ]}
          />
        </div>
      </div>

      {/* Energiefluss */}
      <div className="mt-12">
        <Zwischen>Energiefluss</Zwischen>
        <p className="mt-1.5 text-[13px] text-muted">
          Vom Dach ins Haus, in den Speicher und ins Netz — Bandbreite gleich Strommenge.
        </p>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-[12.5px] font-bold">
          <span>Photovoltaik · {n(Math.round(planung.jahresertragKwh))} kWh</span>
          <span>Haushalt · {n(Math.round(planung.verbrauchKwh))} kWh</span>
        </div>
        <Sankey
          produktion={planung.jahresertragKwh}
          direkt={planung.fluss.direktKwh}
          speicher={planung.fluss.ueberSpeicherKwh}
          einspeisung={planung.fluss.einspeisungKwh}
          netzbezug={planung.fluss.netzbezugKwh}
          verbrauch={planung.verbrauchKwh}
        />
        <div className="flex flex-wrap justify-between gap-2 text-[12.5px] text-muted">
          <span>Netzbezug · {n(Math.round(planung.fluss.netzbezugKwh))} kWh</span>
          <span>Netz · {n(Math.round(planung.fluss.einspeisungKwh))} kWh</span>
        </div>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <div className="border-t-2 border-accent pt-4">
          <p className="text-[44px] leading-none font-extrabold tracking-[-0.045em] tabular-nums text-accent-ink">
            {Math.round(planung.autarkie * 100)} %
          </p>
          <p className="mt-3 max-w-[42ch] text-[13px] leading-[1.55] text-muted">
            Autarkie — so viel deines Verbrauchs deckst du selbst, statt ihn zu kaufen.
          </p>
        </div>
        <div className="border-t-2 border-ink pt-4">
          <p className="text-[44px] leading-none font-extrabold tracking-[-0.045em] tabular-nums">
            {Math.round(planung.eigenverbrauchQuote * 100)} %
          </p>
          <p className="mt-3 max-w-[42ch] text-[13px] leading-[1.55] text-muted">
            Eigenverbrauch — so viel des erzeugten Stroms bleibt im Haus, der Rest geht ins Netz.
          </p>
        </div>
      </div>

      {/* ── Wirtschaftlichkeit ─────────────────────────────────── */}
      <hr className="my-12 border-t border-ink/25" />
      <Kapitel>Wirtschaftlichkeit</Kapitel>
      <Titel>Was die Anlage rechnet</Titel>

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
        <Kennzahl zahl={eur(planung.ersparnis20, 0)} label="Ersparnis in 20 Jahren" akzent />
        {planung.amortisationJahre !== null ? (
          <Kennzahl
            zahl={`${n(Math.round(planung.amortisationJahre * 10) / 10, 1)} Jahre`}
            label={bezahltJahr ? `bezahlt im Jahr ${bezahltJahr}` : "bis sie sich bezahlt hat"}
          />
        ) : null}
        {planung.rendite !== null ? (
          <Kennzahl
            zahl={`${n(Math.round(planung.rendite * 1000) / 10, 1)} %`}
            label="Rendite im Jahr"
          />
        ) : null}
        <Kennzahl zahl={eur(planung.investition, 0)} label="Investition laut Angebot" />
      </div>

      <div className="mt-12">
        <Zwischen>Bis sie sich bezahlt hat</Zwischen>
        <p className="mt-1.5 max-w-[70ch] text-[13px] text-muted">
          Jeder Balken ist ein Jahr: in der Akzentfarbe, solange die Anlage noch nicht bezahlt
          ist{bezahltJahr ? ` — ab ${bezahltJahr} bist du im Plus` : ""}.
        </p>

        <div className="relative mt-6 flex h-[220px] items-stretch gap-[4px]">
          {planung.kurve.map((wert, i) => (
            <div key={i} className="flex flex-1 flex-col">
              <div
                className="flex flex-col justify-end"
                style={{ height: `${(kurveHoch / kurveSpanne) * 100}%` }}
              >
                {wert >= 0 ? (
                  <div
                    className="w-full bg-ink"
                    style={{ height: `${(wert / kurveSpanne) * 100 * (kurveSpanne / (kurveHoch || 1))}%` }}
                  />
                ) : null}
              </div>
              <div style={{ height: `${(Math.abs(kurveTief) / kurveSpanne) * 100}%` }}>
                {wert < 0 ? (
                  <div
                    className="w-full bg-accent"
                    style={{
                      height: `${(Math.abs(wert) / (Math.abs(kurveTief) || 1)) * 100}%`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          ))}
          {/* Die Nulllinie liegt dort, wo der Wechsel passiert. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-ink"
            style={{ top: `${(kurveHoch / kurveSpanne) * 100}%` }}
          />
        </div>

        <div className="mt-2 flex gap-[4px]">
          {planung.kurve.map((_, i) => (
            <span
              key={i}
              className={[
                "num flex-1 text-center text-[10.5px] tabular-nums",
                bezahltJahr === jahr + i ? "font-bold text-accent-ink" : "text-faint",
              ].join(" ")}
            >
              {i === 0 || (i + 1) % 5 === 0 || bezahltJahr === jahr + i ? jahr + i : ""}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <div>
          <Zwischen>Womit gerechnet wurde</Zwischen>
          <div className="mt-4 border-t border-ink">
            <Zeile k="Verbrauch im Haus" v={`${n(Math.round(planung.verbrauchKwh))} kWh`} />
            <Zeile k="Strompreis heute" v={`${eur(planung.strompreis)} je kWh`} />
            <Zeile k="Einspeisevergütung" v={`${eur(planung.verguetung)} je kWh`} />
            <Zeile
              k="Angenommene Steigerung"
              v={`${n(Math.round(planung.steigerung * 1000) / 10, 1)} % im Jahr`}
            />
          </div>
        </div>

        {planung.speicherKwh > 0 && planung.vergleich.preis > 0 ? (
          <div>
            <Zwischen>Mit oder ohne Speicher</Zwischen>
            <table className="mt-4 w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-ink">
                  <th className="py-2.5 text-left"> </th>
                  <th className="py-2.5 text-right text-[11px] font-bold tracking-[0.08em] text-accent-ink uppercase">
                    mit {n(Math.round(planung.speicherKwh * 10) / 10, 1)} kWh
                  </th>
                  <th className="py-2.5 text-right text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
                    ohne Speicher
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Investition",
                    eur(planung.vergleich.mit.investition, 0),
                    eur(planung.vergleich.ohne.investition, 0),
                  ],
                  [
                    "Autarkie",
                    `${Math.round(planung.vergleich.mit.autarkie * 100)} %`,
                    `${Math.round(planung.vergleich.ohne.autarkie * 100)} %`,
                  ],
                  [
                    "Strom aus dem Netz",
                    `${n(Math.round(planung.vergleich.mit.netzbezugKwh))} kWh`,
                    `${n(Math.round(planung.vergleich.ohne.netzbezugKwh))} kWh`,
                  ],
                  [
                    "Ersparnis im Jahr",
                    eur(planung.vergleich.mit.ersparnisJahr1, 0),
                    eur(planung.vergleich.ohne.ersparnisJahr1, 0),
                  ],
                ].map(([k, a, b]) => (
                  <tr key={k} className="border-b border-line">
                    <td className="py-3">{k}</td>
                    <td className="num py-3 text-right font-bold tabular-nums">{a}</td>
                    <td className="num py-3 text-right tabular-nums text-muted">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 max-w-[52ch] text-[12.5px] leading-[1.55] text-muted">
              Der Speicher kostet {eur(planung.vergleich.preis, 0)} und hebt die Autarkie um{" "}
              {Math.round(planung.vergleich.mehrAutarkie * 100)} Punkte. Er spart{" "}
              {eur(planung.vergleich.mehrErsparnisJahr, 0)} im Jahr, weil{" "}
              {n(Math.round(planung.vergleich.wenigerNetzbezugKwh))} kWh weniger aus dem Netz
              kommen.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
