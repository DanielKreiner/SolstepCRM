"use client";

import { useState } from "react";
import { dateTime } from "@/lib/format";
import { Portallink } from "./Portallink";
import {
  AnlageForm,
  KundeBearbeiten,
  PortalZugang,
  type AnlageWerte,
  type KundeWerte,
} from "@/app/(app)/vorgaenge/KundenForms";

/**
 * Der Kunde am Vorgang.
 *
 * Es gab dafür einen eigenen Reiter — eine zweite Liste über dieselben
 * Vorgänge, mit einem Detailpanel, das man erst suchen musste. Wer am
 * Telefon eine Mailadresse korrigiert, hat den Vorgang offen und nicht
 * die Kundenakte.
 *
 * Zugeklappt, weil es Stammdatenpflege ist und nicht der Arbeitsfluss:
 * die tägliche Arbeit steht links im Strom und rechts im Aktionspanel.
 */
export function Kunde({
  kunde,
  anlage,
  portal,
  portalLink,
  vorgangId,
  historie,
  darfSchreiben,
}: {
  kunde: KundeWerte;
  anlage: AnlageWerte | null;
  /** Entschlüsselter Portallink, falls es einen gibt. */
  portalLink: string | null;
  vorgangId: string;
  portal: {
    gueltigBis: string;
    zuletztGesehen: string | null;
    link: string | null;
  } | null;
  /** Was am Kunden passiert ist, über alle seine Vorgänge hinweg. */
  historie: { id: string; kind: string; body: string | null; createdAt: string }[];
  darfSchreiben: boolean;
}) {
  const [offen, setOffen] = useState<Bereich | null>(null);

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Kunde</h2>
        {portal ? (
          <span className="text-[11px] text-s-done">Portal aktiv</span>
        ) : (
          <span className="text-[11px] text-faint">kein Portalzugang</span>
        )}
      </div>

      <dl className="flex flex-col gap-[7px] text-[13px]">
        <Zeile label="Name">{kunde.name}</Zeile>
        <Zeile label="Ansprechpartner">{kunde.contactPerson || "—"}</Zeile>
        <Zeile label="E-Mail">
          <span className="num break-all">{kunde.email || "—"}</span>
        </Zeile>
        <Zeile label="Telefon">
          <span className="num">{kunde.phone || "—"}</span>
        </Zeile>
        <Zeile label="Adresse">
          {[kunde.address, [kunde.zip, kunde.city].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", ") || "—"}
        </Zeile>
      </dl>

      <nav className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        {(
          [
            ["stammdaten", darfSchreiben ? "Stammdaten ändern" : "Stammdaten"],
            ["portal", "Kundenportal"],
            ["anlage", "Anlage"],
            ["historie", `Historie${historie.length ? ` · ${historie.length}` : ""}`],
          ] as const
        ).map(([wert, label]) => (
          <button
            key={wert}
            type="button"
            aria-expanded={offen === wert}
            onClick={() => setOffen(offen === wert ? null : wert)}
            className={[
              "cursor-pointer rounded-pill px-[13px] py-[6px] text-[11.5px] font-medium transition-colors",
              offen === wert
                ? "bg-ink text-app"
                : "border border-line bg-surface text-ink hover:bg-sunk",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </nav>

      {offen === "stammdaten" ? (
        <div className="mt-3">
          {darfSchreiben ? (
            <KundeBearbeiten kunde={kunde} />
          ) : (
            <p className="text-[12px] text-faint">
              Für Kundendaten fehlt deiner Rolle das Schreibrecht.
            </p>
          )}
        </div>
      ) : null}

      {offen === "portal" ? (
        <div className="mt-3 flex flex-col gap-3">
          {/*
            Der Zugang gehört dem Kunden, der Link führt trotzdem direkt
            auf diesen Vorgang: wer anruft, spricht über ein Projekt und
            nicht über eine Kundenakte.
          */}
          {portalLink ? (
            <div className="rounded-[20px] bg-panel p-4">
              <p className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-faint uppercase">
                Direkt zu diesem Vorgang
              </p>
              <Portallink link={portalLink} vorgangId={vorgangId} />
            </div>
          ) : null}
          {darfSchreiben ? (
            <PortalZugang
              customerId={kunde.id}
              kundenName={kunde.name}
              bestehend={portal}
            />
          ) : (
            <p className="text-[12px] text-faint">
              Für den Portalzugang fehlt deiner Rolle das Schreibrecht.
            </p>
          )}
        </div>
      ) : null}

      {offen === "anlage" ? (
        <div className="mt-3">
          {darfSchreiben ? (
            <AnlageForm customerId={kunde.id} anlage={anlage ?? undefined} />
          ) : (
            <p className="text-[12px] text-faint">
              Für die Anlage fehlt deiner Rolle das Schreibrecht.
            </p>
          )}
        </div>
      ) : null}

      {offen === "historie" ? (
        <div className="mt-3">
          {historie.length === 0 ? (
            <p className="text-[12px] text-faint">Noch nichts passiert.</p>
          ) : (
            /*
             * Über alle Vorgänge dieses Kunden, nicht nur diesen. Genau
             * das war der Grund für den Kundenzeitstrahl: wer anruft,
             * fragt nach dem Kunden und nicht nach einer Nummer.
             */
            <ul className="flex flex-col gap-2">
              {historie.map((a) => (
                <li key={a.id} className="rounded-input bg-panel px-3 py-2">
                  <div className="mb-[2px] flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold text-muted">
                      {AKTIVITAET[a.kind] ?? a.kind}
                    </span>
                    <span className="num ml-auto text-[10.5px] text-faint">
                      {dateTime(a.createdAt)}
                    </span>
                  </div>
                  <p className="text-[12.5px] leading-[1.5]">{a.body ?? "—"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

type Bereich = "stammdaten" | "portal" | "anlage" | "historie";

const AKTIVITAET: Record<string, string> = {
  call: "Anruf",
  mail: "Mail",
  portal: "Kundenportal",
  note: "Notiz",
  quote: "Beleg",
  system: "Vorgang",
};

function Zeile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="min-w-[110px] text-[11.5px] text-faint">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
