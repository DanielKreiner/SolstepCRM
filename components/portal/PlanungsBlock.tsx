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

function Zeile({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-[7px] last:border-b-0">
      <span className="text-[13px] text-muted">{k}</span>
      <span className="num ml-auto text-[13px] font-semibold tabular-nums">{v}</span>
    </div>
  );
}

export function PlanungsBlock({ planung }: { planung: NonNullable<PortalDetail["planung"]> }) {
  const hoechst = Math.max(...planung.monateKwh, 1);

  return (
    <section className="mb-6 overflow-hidden rounded-[18px] border border-line bg-surface">
      {planung.bildUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signierter Link, 15 Minuten gültig
        <img
          src={planung.bildUrl}
          alt="Das geplante Dach mit den Modulen"
          className="h-[220px] w-full object-cover"
        />
      ) : null}

      <div className="p-5">
        <h3 className="text-[16px] font-bold">Deine Anlage</h3>

        <div className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <div>
            <Zeile k="Leistung" v={`${n(planung.kwp, 2)} kWp`} />
            <Zeile k="Module" v={`${n(planung.modulAnzahl)} Stück`} />
            {planung.modulTyp ? <Zeile k="Modultyp" v={planung.modulTyp} /> : null}
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

        {/* ── Ertrag übers Jahr ────────────────────────────────── */}
        <h4 className="mt-6 text-[14px] font-bold">Ertrag übers Jahr</h4>
        <p className="mt-1 text-[13px] leading-[1.5] text-muted">
          <span className="num tabular-nums">{n(Math.round(planung.jahresertragKwh))}</span> kWh im
          Jahr, das sind <span className="num tabular-nums">{n(Math.round(planung.spezifisch))}</span>{" "}
          kWh je kWp — gerechnet aus Ausrichtung, Neigung und Verschattung deines Dachs.
        </p>

        <div className="mt-3 flex flex-col gap-[3px]">
          {planung.monateKwh.map((wert, i) => (
            <div key={MONATE[i]} className="flex items-center gap-2.5">
              <span className="w-8 shrink-0 text-[11.5px] text-muted">{MONATE[i]}</span>
              <div className="h-[9px] flex-1 overflow-hidden rounded-pill bg-sunk">
                <div
                  className="h-full rounded-pill bg-accent"
                  style={{ width: `${Math.max(2, (wert / hoechst) * 100)}%` }}
                />
              </div>
              <span className="num w-[62px] shrink-0 text-right text-[11.5px] tabular-nums text-muted">
                {n(Math.round(wert))} kWh
              </span>
            </div>
          ))}
        </div>

        {/* ── Was die Anlage rechnet ───────────────────────────── */}
        <h4 className="mt-6 text-[14px] font-bold">Was die Anlage rechnet</h4>
        <div className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <div>
            <Zeile k="Verbrauch im Haus" v={`${n(Math.round(planung.verbrauchKwh))} kWh`} />
            <Zeile
              k="davon selbst gedeckt"
              v={`${n(Math.round(planung.eigenverbrauchKwh))} kWh`}
            />
            <Zeile k="Autarkie" v={`${Math.round(planung.autarkie * 100)} %`} />
            <Zeile k="Einspeisung" v={`${n(Math.round(planung.einspeisungKwh))} kWh`} />
          </div>
          <div>
            <Zeile k="Strompreis heute" v={`${eur(planung.strompreis)} je kWh`} />
            <Zeile k="Einspeisevergütung" v={`${eur(planung.verguetung)} je kWh`} />
            <Zeile k="Investition" v={eur(planung.investition, 0)} />
            {planung.amortisationJahre !== null ? (
              <Zeile
                k="bezahlt nach"
                v={`${n(Math.round(planung.amortisationJahre * 10) / 10, 1)} Jahren`}
              />
            ) : null}
          </div>
        </div>

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
