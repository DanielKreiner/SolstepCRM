import type { Metadata } from "next";
import Link from "next/link";
import { LaufendeZeit } from "@/components/app/LaufendeZeit";
import { Abschnitt, Zaehler } from "@/components/ui/Abschnitt";
import { Avatar } from "@/components/ui/Avatar";
import { Balkenchart } from "@/components/ui/Balkenchart";
import { LinkButton } from "@/components/ui/Button";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { Ring } from "@/components/ui/RingKarte";
import { eurShort, num, time, weekday } from "@/lib/format";
import { ladeCockpit } from "@/lib/queries/cockpit";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Cockpit" };

const STATUS_TON: Record<string, string> = {
  eingestempelt: "bg-s-done/12 text-s-done",
  pause: "bg-accent/14 text-accent-ink",
  dienstgang: "bg-s-doing/12 text-s-doing",
  abwesend: "bg-s-crit/12 text-s-crit",
  offen: "bg-sunk text-faint",
};

const HANDLUNG_PUNKT: Record<string, string> = {
  kritisch: "bg-s-crit",
  warn: "bg-accent",
  doing: "bg-s-doing",
};

export default async function CockpitPage() {
  const me = await requireMe();
  const c = await ladeCockpit(me.id);

  const heute = new Date().toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const stundenDiff = Math.round((c.stundenWoche.ist - c.stundenWoche.soll) * 10) / 10;

  return (
    <>
      <PageKopf firma={me.company.name} heute={heute} />

      {/* Kennzahlen. Genau eine Akzentkarte — Vorlage Abschnitt 9. */}
      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Auftragsbestand"
          wert={eurShort(c.auftragsbestand)}
          pille={`${c.auftraegeOffen} offen`}
          notiz="exkl. USt."
          href="/vorgaenge"
        />
        <KpiKarte
          label="Auslastung 4 Wochen"
          wert={`${c.auslastung4} %`}
          pille={
            c.kapazitaetProWoche > 0
              ? `${num(c.kapazitaetProWoche)} h/Woche`
              : "keine Kapazität hinterlegt"
          }
          /* Die Pille traegt hier die Kapazitaet, kein Urteil — deshalb
             neutral. Gruen an einer Auslastung von 24 % waere schlicht
             gelogen. */
          ton="neutral"
          notiz="Kapazität aller aktiven Mitarbeiter"
          href="/planung"
        />
        <KpiKarte
          label="Stunden diese Woche"
          wert={num(c.stundenWoche.ist)}
          pille={`${stundenDiff >= 0 ? "+" : ""}${num(stundenDiff)} h`}
          ton={stundenDiff >= 0 ? "gut" : "warn"}
          notiz={`von ${num(c.stundenWoche.soll)} Soll`}
          href="/zeiten"
        />
        <KpiKarte
          label="Offene Rechnungen"
          wert={eurShort(c.rechnungen.offen)}
          pille={
            c.rechnungen.ueberfaellig > 0
              ? `${c.rechnungen.ueberfaellig} überfällig`
              : "nichts überfällig"
          }
          ton={c.rechnungen.ueberfaellig > 0 ? "kritisch" : "gut"}
          notiz={
            c.rechnungen.aeltesteTage !== null
              ? `ältester Rückstand ${c.rechnungen.aeltesteTage} Tage`
              : undefined
          }
          href="/offene-posten"
        />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[1.4fr_1fr_1fr] xl:items-start">
        <Abschnitt
          titel="Auslastung nach Woche"
          rechts={
            c.kapazitaetProWoche > 0 ? (
              <Zaehler>Kapazität {num(c.kapazitaetProWoche)} h</Zaehler>
            ) : null
          }
        >
          <Balkenchart
            balken={c.auslastung.map((w) => ({
              label: w.label,
              prozent: w.prozent,
              offen: w.leer,
              titel: `${w.label}: ${num(w.stunden)} von ${num(c.kapazitaetProWoche)} h`,
            }))}
          />
        </Abschnitt>

        <Abschnitt titel="Nächster Termin">
          {c.naechsterTermin ? (
            <>
              <p className="text-[19px] leading-[1.2] font-semibold tracking-[-0.02em]">
                {c.naechsterTermin.titel}
              </p>
              <p className="num mt-2 text-[12.5px] text-muted">
                {weekday(c.naechsterTermin.start)},{" "}
                {new Date(c.naechsterTermin.start).toLocaleDateString("de-AT")} ·{" "}
                {time(c.naechsterTermin.start)}
              </p>
              <p className="mt-1 text-[12.5px] text-faint">
                {[c.naechsterTermin.kunde, c.naechsterTermin.ort]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="mt-4">
                <Link
                  href={`/vorgaenge/${c.naechsterTermin.vorgangId}`}
                  className="inline-flex w-full items-center justify-center rounded-pill bg-[#151210] px-5 py-[13px] text-[13px] font-semibold text-white hover:text-white"
                >
                  Zum Vorgang {c.naechsterTermin.nummer}
                </Link>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-muted">
              Kein Auftrag terminiert. In der{" "}
              <Link href="/planung">Planung</Link> liegen die
              nicht terminierten Aufträge im Pool.
            </p>
          )}
        </Abschnitt>

        <Abschnitt
          titel="Handlungsbedarf"
          rechts={
            c.handlungsbedarf.length > 0 ? (
              <Zaehler>{c.handlungsbedarf.length}</Zaehler>
            ) : null
          }
        >
          {c.handlungsbedarf.length === 0 ? (
            <p className="text-[13px] text-muted">
              Nichts offen — keine Überlast, keine überfällige Rechnung, kein
              Material unter Mindestbestand.
            </p>
          ) : (
            <ul className="flex flex-col gap-[10px]">
              {c.handlungsbedarf.map((h, i) => (
                <li key={`${h.titel}-${i}`}>
                  <Link
                    href={h.href}
                    className="flex gap-[10px] text-ink hover:text-ink"
                  >
                    <span
                      aria-hidden
                      className={`mt-[6px] h-[7px] w-[7px] shrink-0 rounded-pill ${HANDLUNG_PUNKT[h.ton]}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] leading-snug font-medium">
                        {h.titel}
                      </span>
                      <span className="num block text-[11.5px] text-faint">
                        {h.detail}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Abschnitt>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr_1fr] xl:items-start">
        <Abschnitt
          titel="Team heute"
          rechts={
            <Zaehler>
              {c.team.filter((t) => t.status === "eingestempelt").length} von{" "}
              {c.team.length} eingestempelt
            </Zaehler>
          }
        >
          {c.team.length === 0 ? (
            <p className="text-[13px] text-muted">Keine aktiven Mitarbeiter.</p>
          ) : (
            <ul className="flex flex-col gap-[2px]">
              {c.team.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-input px-2 py-[7px]"
                >
                  <Avatar name={p.name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">
                      {p.name}
                    </span>
                    <span className="num block truncate text-[11.5px] text-faint">
                      {[p.auftrag, p.rolle].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-pill px-[9px] py-[3px] text-[11px] font-medium ${STATUS_TON[p.status]}`}
                  >
                    {p.statusText}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Abschnitt>

        <Abschnitt titel="Pipeline-Fortschritt">
          <div className="flex flex-col items-center gap-3 py-2">
            <Ring
              prozent={c.pipeline.prozent}
              size={116}
              dicke={11}
              label="Abgeschlossene Aufträge"
              ton="done"
            />
            <p className="num text-[12.5px] text-muted">
              {c.pipeline.abgeschlossen} von {c.pipeline.gesamt} Vorgängen
              abgeschlossen
            </p>
          </div>
        </Abschnitt>

        {c.laufend ? (
          <LaufendeZeit
            seit={c.laufend.seit}
            auftragNummer={c.laufend.auftragNummer}
            auftragId={c.laufend.auftragId}
            personen={c.laufend.personen}
            eigene={c.laufend.eigene}
          />
        ) : (
          <Abschnitt titel="Zeit läuft">
            <p className="text-[13px] text-muted">
              Gerade steht niemand auf der Uhr.
            </p>
            <div className="mt-4">
              <LinkButton href="/zeiten" variant="quiet">
                Zeiterfassung öffnen
              </LinkButton>
            </div>
          </Abschnitt>
        )}
      </div>
    </>
  );
}

function PageKopf({ firma, heute }: { firma: string; heute: string }) {
  return (
    <div className="mb-[22px] flex flex-wrap items-start gap-4">
      <div className="min-w-[240px] flex-1">
        <h1 className="text-[32px] leading-[1.1] font-bold tracking-[-0.03em]">
          Cockpit
        </h1>
        <p className="mt-[6px] text-[14.5px] text-muted">
          {firma} · {heute}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-[10px]">
        {/*
          Die Vorlage zeigt hier "Auftrag anlegen". Aufträge entstehen in
          diesem System aber aus angenommenen Angeboten (SPEC 4.4, Schritt 6)
          — ein Knopf, der einen Auftrag aus dem Nichts erzeugt, umginge die
          Kalkulation. Der Weg führt deshalb über das Angebot.
        */}
        <LinkButton href="/vorgaenge">Vorgang anlegen</LinkButton>
        <LinkButton href="/berichte" variant="ghost">
          Berichte
        </LinkButton>
      </div>
    </div>
  );
}
