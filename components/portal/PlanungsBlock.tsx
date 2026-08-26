import type { PortalDetail } from "@/lib/portal/vorgang";

/*
 * Die Planung im Kundenportal.
 *
 * Derselbe Aufbau wie im Angebots-PDF: das Dach als Bild, die Anlage in
 * Zahlen, der Ertrag übers Jahr, was sie rechnet. Vorher stand im
 * Portal nur die Preisliste, während die Ertragsrechnung in einem
 * zweiten PDF lag — der Kunde musste zwei Dokumente nebeneinanderlegen,
 * um zu verstehen, wofür er zahlt.
 *
 * Bewusst ohne Diagrammbibliothek: zwölf Balken sind zwölf divs mit
 * einer Breite in Prozent. Alles andere wäre ein halbes Megabyte
 * JavaScript für eine Kurve, die sich nicht bewegt.
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

/** Kleine Überschrift in Versalien — dieselbe Sprache wie im PDF. */
function Abschnitt({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mt-7 mb-3 text-[10.5px] font-bold tracking-[0.11em] text-faint uppercase">
      {children}
    </h4>
  );
}

/**
 * Eine Kennzahl im Band: grosse Zahl, kleine Erklärung, Haarlinie davor.
 *
 * Ohne Rahmen — vier umrandete Kästchen nebeneinander sehen aus wie ein
 * Formular. Die Trennlinie reicht, damit die Zahlen nicht ineinander
 * laufen.
 */
function Kennzahl({
  zahl,
  label,
  akzent = false,
  strich = false,
}: {
  zahl: string;
  label: string;
  akzent?: boolean;
  strich?: boolean;
}) {
  return (
    <div className={strich ? "sm:border-l sm:border-line sm:pl-5" : ""}>
      <p
        className={[
          "num text-[23px] leading-none font-extrabold tracking-[-0.03em] tabular-nums",
          akzent ? "text-accent-ink" : "",
        ].join(" ")}
      >
        {zahl}
      </p>
      <p className="mt-2 text-[11.5px] leading-[1.4] text-muted">{label}</p>
    </div>
  );
}

function Zeile({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-[7px] last:border-b-0">
      <span className="text-[13px] text-muted">{k}</span>
      <span className="num ml-auto text-[13px] font-semibold tabular-nums">{v}</span>
    </div>
  );
}

/** Ein waagrechtes Band, in Anteilen eingefärbt. */
function Flussband({ teile }: { teile: Array<{ wert: number; klasse: string }> }) {
  const gesamt = teile.reduce((a, t) => a + Math.max(0, t.wert), 0) || 1;
  return (
    <div className="mt-2 flex h-[22px] overflow-hidden rounded-[8px]">
      {teile.map((t, i) => {
        const anteil = Math.max(0, t.wert) / gesamt;
        return (
          <div
            key={i}
            className={`grid place-items-center ${t.klasse}`}
            style={{ width: `${anteil * 100}%` }}
          >
            {/* Unter acht Prozent ist kein Platz für eine Zahl. */}
            {anteil > 0.08 ? (
              <span className="num text-[10.5px] font-bold text-white">
                {Math.round(anteil * 100)} %
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Legende({ eintraege }: { eintraege: Array<[string, string]> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {eintraege.map(([text, klasse]) => (
        <span key={text} className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className={`h-2.5 w-2.5 rounded-[3px] ${klasse}`} />
          {text}
        </span>
      ))}
    </div>
  );
}

/**
 * Die kumulierte Ersparnis als Säulen.
 *
 * Rot, solange die Anlage nicht bezahlt ist, danach grün. Zwölf Balken
 * mit einer Höhe in Prozent — dafür braucht es keine Diagrammbibliothek.
 */
function Kurve({ kurve }: { kurve: number[] }) {
  if (kurve.length === 0) return null;
  const hoch = Math.max(...kurve, 0);
  const tief = Math.min(...kurve, 0);
  const spanne = hoch - tief || 1;
  const jahr = new Date().getFullYear();

  return (
    <>
      <div className="mt-4 flex h-[120px] items-end gap-[3px]">
        {kurve.map((wert, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            <div
              className={wert >= 0 ? "rounded-t-[3px] bg-s-done" : "rounded-b-[3px] bg-s-crit"}
              style={{
                height: `${(Math.abs(wert) / spanne) * 100}%`,
                marginTop: wert >= 0 ? "auto" : 0,
                marginBottom: wert >= 0 ? `${(Math.abs(tief) / spanne) * 100}%` : `${((Math.abs(tief) - Math.abs(wert)) / spanne) * 100}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {kurve.map((_, i) => (
          <span key={i} className="num flex-1 text-center text-[9px] text-faint">
            {i === 0 || (i + 1) % 5 === 0 ? jahr + 1 + i : ""}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[11.5px] leading-[1.45] text-muted">
        Rot ist die Zeit, in der die Anlage noch nicht bezahlt ist. Ab dem grünen Jahr hast du
        mehr gespart als investiert.
      </p>
    </>
  );
}

function Vergleich({ k, a, b }: { k: string; a: string; b: string }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="py-[7px] text-muted">{k}</td>
      <td className="num py-[7px] text-right font-semibold tabular-nums">{a}</td>
      <td className="num py-[7px] text-right tabular-nums text-muted">{b}</td>
    </tr>
  );
}

export function PlanungsBlock({
  planung,
  kunde,
  adresse,
}: {
  planung: NonNullable<PortalDetail["planung"]>;
  /** Für den Titel über dem Dach — der Kunde soll sein Haus erkennen. */
  kunde?: string;
  adresse?: string | null;
}) {
  const hoechst = Math.max(...planung.monateKwh, 1);

  return (
    <section className="mb-6 overflow-hidden rounded-[22px] bg-surface shadow-soft">
      {/*
        Das Dach als Aufmacher, nicht als Illustration.
        
        Der Kunde sieht sein eigenes Haus mit den Modulen darauf, und
        darüber liegt der einzige Satz, der ihn wirklich interessiert:
        was er im Jahr spart. Vorher war das Foto eine Kachel unter
        anderen, und die Seite las sich wie ein Formular.
      */}
      {planung.bildUrl ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- signierter Link, 15 Minuten gültig */}
          <img
            src={planung.bildUrl}
            alt="Das geplante Dach mit den Modulen"
            className="h-[300px] w-full object-cover sm:h-[380px]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(12,11,10,.88)_0%,rgba(12,11,10,.55)_38%,rgba(12,11,10,.05)_72%)]" />

          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            {adresse ? (
              <p className="num text-[11.5px] tracking-[0.06em] text-white/70 uppercase">
                {adresse}
              </p>
            ) : null}
            <h3 className="mt-1 max-w-[22ch] text-[26px] leading-[1.15] font-extrabold tracking-[-0.03em] text-white sm:text-[32px]">
              {planung.ersparnisJahr1 > 0 ? (
                <>
                  {kunde ? `${kunde.split(" ")[0]}, du sparst ` : "Du sparst "}
                  <span className="num text-accent-from">
                    {n(Math.round(planung.ersparnisJahr1))} €
                  </span>{" "}
                  im Jahr.
                </>
              ) : (
                "Deine Anlage auf deinem Dach."
              )}
            </h3>
            <p className="mt-2 max-w-[52ch] text-[13px] leading-[1.55] text-white/75">
              {n(planung.kwp, 2)} kWp auf {n(planung.modulAnzahl)} Modulen
              {planung.speicherKwh > 0
                ? `, dazu ${n(Math.round(planung.speicherKwh * 10) / 10, 1)} kWh Speicher`
                : ""}{" "}
              — {Math.round(planung.autarkie * 100)} % deines Stroms kommen dann vom eigenen
              Dach.
            </p>
          </div>
        </div>
      ) : null}

      <div className="p-5 sm:p-7">
        {/*
          Die Kennzahlen als Band mit Haarlinien statt vier Kästchen:
          weniger Rahmen, mehr Ruhe, und die Zahlen dürfen gross sein.
        */}
        <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-4 sm:gap-y-0">
          <Kennzahl zahl={`${n(planung.kwp, 2)} kWp`} label="Anlagenleistung" akzent />
          <Kennzahl zahl={n(planung.modulAnzahl)} label="Module auf dem Dach" strich />
          {planung.speicherKwh > 0 ? (
            <Kennzahl
              zahl={`${n(Math.round(planung.speicherKwh * 10) / 10, 1)} kWh`}
              label="Speicher"
              strich
            />
          ) : null}
          <Kennzahl
            zahl={`${n(Math.round(planung.jahresertragKwh))} kWh`}
            label="Ertrag im Jahr"
            strich
          />
        </div>

        <Abschnitt>Was verbaut wird</Abschnitt>
        <div className="grid gap-x-8 rounded-[14px] border border-line px-4 py-1 sm:grid-cols-2">
          <div>
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
          </div>
          <div>
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
        </div>

        {/* ── Was das Dach im Jahr liefert ─────────────────────── */}
        <Abschnitt>Monat für Monat</Abschnitt>
        <p className="-mt-1 mb-3 text-[13px] leading-[1.5] text-muted">
          <span className="num tabular-nums">{n(Math.round(planung.jahresertragKwh))}</span> kWh,
          das sind <span className="num tabular-nums">{n(Math.round(planung.spezifisch))}</span>{" "}
          kWh je kWp. Die Farben zeigen, was direkt ins Haus geht, was über den Speicher läuft
          und was eingespeist wird.
        </p>

        <div className="mt-3 flex flex-col gap-[3px]">
          {planung.fluss.monate.map((m, i) => {
            const hoechst = Math.max(...planung.fluss.monate.map((x) => x.produktion), 1);
            const breit = (wert: number) => `${(wert / hoechst) * 100}%`;
            return (
              <div key={MONATE[i]} className="flex items-center gap-2.5">
                <span className="w-8 shrink-0 text-[11.5px] text-muted">{MONATE[i]}</span>
                <div className="flex h-[10px] flex-1 overflow-hidden rounded-pill bg-sunk">
                  <div className="h-full bg-accent" style={{ width: breit(m.direkt) }} />
                  <div className="h-full bg-s-warn/45" style={{ width: breit(m.speicher) }} />
                  <div className="h-full bg-faint/40" style={{ width: breit(m.einspeisung) }} />
                </div>
                <span className="num w-[62px] shrink-0 text-right text-[11.5px] tabular-nums text-muted">
                  {n(Math.round(m.produktion))} kWh
                </span>
              </div>
            );
          })}
        </div>
        <Legende
          eintraege={[
            ["Direkt verbraucht", "bg-accent"],
            ["Über den Speicher", "bg-s-warn/45"],
            ["Ins Netz", "bg-faint/40"],
          ]}
        />

        {/* ── Wohin und woher ──────────────────────────────────── */}
        <Abschnitt>Wohin geht dein Strom?</Abschnitt>
        <p className="mt-1 text-[13px] text-muted">
          Von <span className="num tabular-nums">{n(Math.round(planung.jahresertragKwh))}</span> kWh
          Erzeugung bleiben {Math.round(planung.eigenverbrauchQuote * 100)} % im Haus.
        </p>
        <Flussband
          teile={[
            { wert: planung.fluss.direktKwh, klasse: "bg-accent" },
            { wert: planung.fluss.ueberSpeicherKwh, klasse: "bg-s-warn/45" },
            { wert: planung.fluss.einspeisungKwh, klasse: "bg-faint/40" },
          ]}
        />
        <Legende
          eintraege={[
            [`Direkt ${n(Math.round(planung.fluss.direktKwh))} kWh`, "bg-accent"],
            [`Speicher ${n(Math.round(planung.fluss.ueberSpeicherKwh))} kWh`, "bg-s-warn/45"],
            [`Netz ${n(Math.round(planung.fluss.einspeisungKwh))} kWh`, "bg-faint/40"],
          ]}
        />

        <Abschnitt>Woher kommt dein Strom?</Abschnitt>
        <p className="mt-1 text-[13px] text-muted">
          Dein Haushalt braucht{" "}
          <span className="num tabular-nums">{n(Math.round(planung.verbrauchKwh))}</span> kWh im
          Jahr.
        </p>
        <Flussband
          teile={[
            { wert: planung.fluss.direktKwh, klasse: "bg-accent" },
            { wert: planung.fluss.ueberSpeicherKwh, klasse: "bg-s-warn/45" },
            { wert: planung.fluss.netzbezugKwh, klasse: "bg-faint/40" },
          ]}
        />
        <Legende
          eintraege={[
            [`Vom Dach ${n(Math.round(planung.fluss.direktKwh))} kWh`, "bg-accent"],
            [
              `Aus dem Speicher ${n(Math.round(planung.fluss.ueberSpeicherKwh))} kWh`,
              "bg-s-warn/45",
            ],
            [`Aus dem Netz ${n(Math.round(planung.fluss.netzbezugKwh))} kWh`, "bg-faint/40"],
          ]}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[14px] bg-sunk p-4">
            <p className="num text-[22px] leading-none font-extrabold text-accent-ink">
              {Math.round(planung.autarkie * 100)} %
            </p>
            <p className="mt-1.5 text-[12px] leading-[1.45] text-muted">
              Autarkie — so viel deines Verbrauchs deckst du selbst, statt ihn zu kaufen.
            </p>
          </div>
          <div className="rounded-[14px] bg-sunk p-4">
            <p className="num text-[22px] leading-none font-extrabold">
              {Math.round(planung.eigenverbrauchQuote * 100)} %
            </p>
            <p className="mt-1.5 text-[12px] leading-[1.45] text-muted">
              Eigenverbrauch — so viel des erzeugten Stroms bleibt im Haus, der Rest geht ins
              Netz.
            </p>
          </div>
        </div>

        {/* ── Was die Anlage rechnet ───────────────────────────── */}
        <Abschnitt>Was die Anlage rechnet</Abschnitt>
        <div className="grid gap-x-8 rounded-[14px] border border-line px-4 py-1 sm:grid-cols-2">
          <div>
            <Zeile k="Investition" v={eur(planung.investition, 0)} />
            <Zeile k="Ersparnis im Jahr" v={eur(planung.ersparnisJahr1, 0)} />
            {planung.amortisationJahre !== null ? (
              <Zeile
                k="bezahlt nach"
                v={`${n(Math.round(planung.amortisationJahre * 10) / 10, 1)} Jahren`}
              />
            ) : null}
          </div>
          <div>
            {planung.rendite !== null ? (
              <Zeile
                k="Rendite im Jahr"
                v={`${n(Math.round(planung.rendite * 1000) / 10, 1)} %`}
              />
            ) : null}
            <Zeile k="Strompreis heute" v={`${eur(planung.strompreis)} je kWh`} />
            <Zeile k="Einspeisevergütung" v={`${eur(planung.verguetung)} je kWh`} />
          </div>
        </div>

        <Kurve kurve={planung.kurve} />

        {/* ── Mit oder ohne Speicher ───────────────────────────── */}
        {planung.speicherKwh > 0 && planung.vergleich.preis > 0 ? (
          <>
            <Abschnitt>Mit oder ohne Speicher</Abschnitt>
            <p className="-mt-1 text-[13px] leading-[1.5] text-muted">
              Dieselbe Anlage, zwei Rechnungen. Ohne Speicher ist sie billiger und deckt
              weniger.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[380px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11.5px] text-muted">
                    <th className="py-2 text-left font-medium"> </th>
                    <th className="py-2 text-right font-semibold text-accent-ink">
                      mit {n(Math.round(planung.speicherKwh * 10) / 10, 1)} kWh
                    </th>
                    <th className="py-2 text-right font-medium">ohne Speicher</th>
                  </tr>
                </thead>
                <tbody>
                  <Vergleich
                    k="Investition"
                    a={eur(planung.vergleich.mit.investition, 0)}
                    b={eur(planung.vergleich.ohne.investition, 0)}
                  />
                  <Vergleich
                    k="Autarkie"
                    a={`${Math.round(planung.vergleich.mit.autarkie * 100)} %`}
                    b={`${Math.round(planung.vergleich.ohne.autarkie * 100)} %`}
                  />
                  <Vergleich
                    k="Strom aus dem Netz"
                    a={`${n(Math.round(planung.vergleich.mit.netzbezugKwh))} kWh`}
                    b={`${n(Math.round(planung.vergleich.ohne.netzbezugKwh))} kWh`}
                  />
                  <Vergleich
                    k="Ersparnis im Jahr"
                    a={eur(planung.vergleich.mit.ersparnisJahr1, 0)}
                    b={eur(planung.vergleich.ohne.ersparnisJahr1, 0)}
                  />
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] leading-[1.5] text-muted">
              Der Speicher kostet {eur(planung.vergleich.preis, 0)} und hebt die Autarkie um{" "}
              {Math.round(planung.vergleich.mehrAutarkie * 100)} Punkte. Er spart{" "}
              {eur(planung.vergleich.mehrErsparnisJahr, 0)} im Jahr, weil{" "}
              {n(Math.round(planung.vergleich.wenigerNetzbezugKwh))} kWh weniger aus dem Netz
              kommen.
            </p>
          </>
        ) : null}

        <div className="mt-5 rounded-[14px] bg-sunk p-4">
          <p className="text-[19px] font-extrabold leading-[1.25] text-accent-ink">
            Du sparst rund{" "}
            <span className="num tabular-nums">{n(Math.round(planung.ersparnisJahr1))} €</span> im
            Jahr.
          </p>
          <p className="mt-1.5 text-[13px] leading-[1.5] text-muted">
            Über zwanzig Jahre sind das rund{" "}
            <span className="num tabular-nums">{n(Math.round(planung.ersparnis20))} €</span>
            {planung.amortisationJahre !== null
              ? `; bezahlt hat sich die Anlage nach etwa ${
                  n(Math.round(planung.amortisationJahre * 10) / 10, 1)
                } Jahren.`
              : "."}
          </p>
          <p className="mt-2 text-[11.5px] leading-[1.45] text-muted">
            Richtwerte aus der Planung — der Ertrag hängt vom Wetter ab, die Ersparnis vom
            Strompreis. Steigt er, wird die Rechnung besser.
          </p>
        </div>
      </div>
    </section>
  );
}
