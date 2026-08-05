"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { initials } from "@/lib/format";
import { einsatzVerschieben } from "@/app/(app)/planung/actions";
import type { EinsatzKonflikt } from "@/lib/einsatz/konflikte";

/*
 * Die Plantafel.
 *
 * Eine Zeile je Mitarbeiter, darunter die Fahrzeuge als eigene
 * Ressourcen. Blöcke sind Einsätze, farbcodiert nach Art. Abwesenheiten
 * stehen in derselben Tafel — ohne sie wäre jede Konfliktprüfung
 * wertlos, weil niemand sieht, warum eine Warnung kommt.
 *
 * Kein Zeitraster innerhalb des Tages: ein PV-Betrieb fährt morgens auf
 * eine Baustelle und bleibt den Tag dort. Ein Stundenraster würde
 * Genauigkeit vortäuschen, die die Planung nicht hat — die Uhrzeit steht
 * im Block.
 */

export type TafelPerson = {
  id: string;
  name: string;
  rolle: string;
  qualifikationen: string[];
};

export type TafelBlock = {
  id: string;
  art: "auftrag" | "service" | "intern";
  titel: string;
  von: string;
  bis: string;
  ganztaegig: boolean;
  personen: string[];
  fahrzeugId: string | null;
  vorgangId: string | null;
  vorgangNummer: string | null;
  kundeId: string | null;
  kundeName: string | null;
  serviceTicketId: string | null;
  anzahlStopps: number;
  notiz: string | null;
  subText: string | null;
  benoetigt: string[];
};

export type TafelAbw = {
  id: string;
  userId: string;
  von: string;
  bis: string;
  art: string;
  status: string;
};

const ART_STIL: Record<string, string> = {
  auftrag: "bg-accent/12 text-accent-ink",
  service: "bg-s-done/12 text-s-done",
  intern: "bg-sunk text-muted",
};

const ART_LABEL: Record<string, string> = {
  auftrag: "AUFTRAG",
  service: "SERVICE",
  intern: "INTERN",
};

const ABW_LABEL: Record<string, string> = {
  vacation: "Urlaub",
  sick: "Krankenstand",
  leave_comp: "Zeitausgleich",
  care: "Pflegefreistellung",
  school: "Schulung",
  special: "Sonderurlaub",
};

const ROLLE: Record<string, string> = {
  gf: "Geschäftsführung",
  buero: "Büro",
  bauleitung: "Bauleitung",
  monteur: "Monteur",
  lager: "Lager",
};

function tagesSchluessel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function uhr(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Plantafel({
  tage,
  personen,
  fahrzeuge,
  bloecke,
  abwesenheiten,
  darfPlanen,
  neuerEinsatz,
  einsatzOeffnen,
}: {
  /** Die Tage der Woche, als lokale Mitternachtszeitpunkte. */
  tage: string[];
  personen: TafelPerson[];
  fahrzeuge: { id: string; name: string; kennzeichen: string | null }[];
  bloecke: TafelBlock[];
  abwesenheiten: TafelAbw[];
  darfPlanen: boolean;
  /** Klick auf eine leere Zelle: Tag und Person für den Dialog. */
  neuerEinsatz: (tag: string, userId: string | null) => void;
  /** Klick auf einen Block: derselbe Dialog, nur mit Inhalt. */
  einsatzOeffnen: (id: string) => void;
}) {
  const [warten, uebergang] = useTransition();
  const [meldung, setMeldung] = useState<{
    text: string;
    art: "fehler" | "hinweis";
    regel?: string;
  } | null>(null);

  const sensoren = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function abgelegt(e: DragEndEvent) {
    const ziel = e.over?.id ? String(e.over.id) : null;
    if (!ziel) return;

    const block = bloecke.find((b) => b.id === String(e.active.id));
    if (!block) return;

    /* Zellen-IDs sind "z:<tag>:<userId|->". */
    const [, tag, wer] = ziel.split(":");
    if (!tag) return;

    /*
     * Die Uhrzeit bleibt, das Datum wandert. Wer einen Block auf einen
     * anderen Tag zieht, will ihn verschieben und nicht neu terminieren.
     */
    const vonAlt = new Date(block.von);
    const bisAlt = new Date(block.bis);
    const dauer = bisAlt.getTime() - vonAlt.getTime();

    const [j, m, t] = tag.split("-").map(Number);
    const vonNeu = new Date(vonAlt);
    vonNeu.setFullYear(j!, m! - 1, t!);
    const bisNeu = new Date(vonNeu.getTime() + dauer);

    if (vonNeu.getTime() === vonAlt.getTime() && (!wer || wer === "-")) return;

    setMeldung(null);
    uebergang(async () => {
      const r = await einsatzVerschieben({
        einsatzId: block.id,
        von: vonNeu.toISOString(),
        bis: bisNeu.toISOString(),
        userId: wer && wer !== "-" ? wer : null,
      });
      if (r.error) setMeldung({ text: r.error, art: "fehler" });
      else if (r.warnungen?.length) {
        const w = r.warnungen[0]!;
        setMeldung({
          text: w.text,
          art: "hinweis",
          ...(w.regel ? { regel: w.regel } : {}),
        });
      }
    });
  }

  const zeilen = [
    ...personen.map((p) => ({ typ: "person" as const, ...p })),
    ...fahrzeuge.map((f) => ({
      typ: "fahrzeug" as const,
      id: f.id,
      name: f.name,
      rolle: "Fahrzeug",
      qualifikationen: [] as string[],
      kennzeichen: f.kennzeichen,
    })),
  ];

  return (
    <>
      {meldung ? (
        <div
          role="status"
          className={[
            "mb-3 flex flex-wrap items-center gap-3 rounded-[20px] px-5 py-4 shadow-soft",
            meldung.art === "fehler" ? "bg-s-crit/10" : "bg-surface",
          ].join(" ")}
        >
          <span
            className={[
              "shrink-0 rounded-pill px-[11px] py-[3px] text-[10.5px] font-bold tracking-[0.08em]",
              meldung.art === "fehler"
                ? "bg-s-crit/15 text-s-crit"
                : "bg-s-warn/15 text-accent-ink",
            ].join(" ")}
          >
            {meldung.art === "fehler" ? "GESPERRT" : "WEICH"}
          </span>
          <span className="min-w-0 flex-1 text-[13.5px] font-medium">
            {meldung.text}
          </span>
          {meldung.regel ? (
            <span className="num shrink-0 text-[12px] text-muted">{meldung.regel}</span>
          ) : null}
          <button
            type="button"
            onClick={() => setMeldung(null)}
            className="shrink-0 cursor-pointer rounded-pill border border-line bg-surface px-[15px] py-[7px] text-[12.5px] font-medium"
          >
            Verstanden
          </button>
        </div>
      ) : null}

      <DndContext
        id="plantafel"
        sensors={sensoren}
        collisionDetection={pointerWithin}
        onDragEnd={abgelegt}
      >
        <div className="overflow-x-auto rounded-panel bg-surface shadow-soft">
          <div className="min-w-[1000px]">
            {/* ------------------------------------------- KOPFZEILE */}
            <div
              className="grid border-b border-line"
              style={{ gridTemplateColumns: `210px repeat(${tage.length}, 1fr)` }}
            >
              <div className="px-4 py-[14px] text-[10.5px] font-semibold tracking-[0.1em] text-faint uppercase">
                Ressource
              </div>
              {tage.map((t) => {
                const d = new Date(t);
                const heute = tagesSchluessel(new Date()) === tagesSchluessel(d);
                return (
                  <div key={t} className="border-l border-line px-4 py-[14px]">
                    <div
                      className={[
                        "text-[13px] font-semibold",
                        heute ? "text-accent-ink" : "",
                      ].join(" ")}
                    >
                      {d.toLocaleDateString("de-AT", { weekday: "short" })}
                    </div>
                    <div className="num text-[11.5px] text-faint">
                      {d.toLocaleDateString("de-AT", {
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ---------------------------------------------- ZEILEN */}
            {zeilen.map((z) => (
              <div
                key={`${z.typ}-${z.id}`}
                className="grid border-b border-line last:border-b-0"
                style={{ gridTemplateColumns: `210px repeat(${tage.length}, 1fr)` }}
              >
                <div className="flex items-start gap-[10px] px-4 py-3">
                  <span
                    aria-hidden
                    className={[
                      "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-pill text-[10px] font-semibold",
                      z.typ === "fahrzeug"
                        ? "bg-sunk text-muted"
                        : "bg-s-doing text-white",
                    ].join(" ")}
                  >
                    {z.typ === "fahrzeug" ? "FZ" : initials(z.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold">
                      {z.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted">
                      {z.typ === "fahrzeug"
                        ? ((z as { kennzeichen: string | null }).kennzeichen ?? "Fahrzeug")
                        : (ROLLE[z.rolle] ?? z.rolle)}
                    </span>
                    {z.typ === "person" ? (
                      <span className="num mt-[3px] block text-[10.5px] text-faint">
                        {z.qualifikationen.length
                          ? z.qualifikationen.join(" · ")
                          : "keine Zusatzqualifikation"}
                      </span>
                    ) : null}
                  </span>
                </div>

                {tage.map((t) => (
                  <Zelle
                    key={t}
                    tag={t}
                    zeile={z}
                    bloecke={bloecke}
                    abwesenheiten={abwesenheiten}
                    darfPlanen={darfPlanen}
                    warten={warten}
                    neuerEinsatz={neuerEinsatz}
                    einsatzOeffnen={einsatzOeffnen}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </DndContext>
    </>
  );
}

function Zelle({
  tag,
  zeile,
  bloecke,
  abwesenheiten,
  darfPlanen,
  warten,
  neuerEinsatz,
  einsatzOeffnen,
}: {
  tag: string;
  zeile: { typ: "person" | "fahrzeug"; id: string };
  bloecke: TafelBlock[];
  abwesenheiten: TafelAbw[];
  darfPlanen: boolean;
  warten: boolean;
  neuerEinsatz: (tag: string, userId: string | null) => void;
  einsatzOeffnen: (id: string) => void;
}) {
  const zellId = `z:${tag}:${zeile.typ === "person" ? zeile.id : "-"}`;
  const { setNodeRef, isOver } = useDroppable({ id: zellId, disabled: !darfPlanen });

  const tagStart = new Date(tag);
  const tagEnde = new Date(tagStart);
  tagEnde.setDate(tagEnde.getDate() + 1);

  const drin = bloecke.filter((b) => {
    const passt =
      zeile.typ === "person"
        ? b.personen.includes(zeile.id)
        : b.fahrzeugId === zeile.id;
    if (!passt) return false;
    return new Date(b.von) < tagEnde && tagStart < new Date(b.bis);
  });

  const abw =
    zeile.typ === "person"
      ? abwesenheiten.filter(
          (a) => a.userId === zeile.id && a.von <= tag && tag <= a.bis,
        )
      : [];

  return (
    <div
      ref={setNodeRef}
      className={[
        "min-h-[86px] border-l border-line p-[7px] transition-colors",
        isOver ? "bg-accent/8" : "",
      ].join(" ")}
    >
      {abw.map((a) => (
        <div
          key={a.id}
          /*
           * Schraffur statt Fläche: eine Abwesenheit ist kein Einsatz,
           * und wer die Tafel überfliegt, soll das ohne Lesen sehen.
           */
          className="mb-[6px] rounded-input border border-s-waiting/30 px-[10px] py-[7px]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, color-mix(in srgb, var(--s-waiting) 12%, transparent) 0 6px, transparent 6px 12px)",
          }}
        >
          <div className="num text-[9.5px] font-semibold tracking-[0.06em] text-s-waiting uppercase">
            Abwesenheit ganztägig
          </div>
          <div className="text-[12.5px] font-semibold text-s-waiting">
            {ABW_LABEL[a.art] ?? a.art}
          </div>
          <div className="text-[11px] text-muted">
            {a.status === "approved" ? "genehmigt" : "beantragt"}
          </div>
        </div>
      ))}

      {drin.map((b) => (
        <Block
          key={b.id}
          block={b}
          ziehbar={darfPlanen && !warten}
          oeffnen={einsatzOeffnen}
        />
      ))}

      {darfPlanen && drin.length === 0 && abw.length === 0 ? (
        <button
          type="button"
          onClick={() => neuerEinsatz(tag, zeile.typ === "person" ? zeile.id : null)}
          aria-label="Einsatz anlegen"
          className="h-full min-h-[70px] w-full cursor-pointer rounded-input border-0 bg-transparent text-[18px] text-transparent transition-colors hover:bg-panel hover:text-faint"
        >
          +
        </button>
      ) : null}
    </div>
  );
}

function Block({
  block,
  ziehbar,
  oeffnen,
}: {
  block: TafelBlock;
  ziehbar: boolean;
  oeffnen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    disabled: !ziehbar,
  });

  const inhalt = (
    <>
      <div className="num text-[9.5px] font-semibold tracking-[0.06em] uppercase opacity-80">
        {ART_LABEL[block.art]}{" "}
        {block.ganztaegig ? "ganztägig" : `${uhr(block.von)}–${uhr(block.bis)}`}
      </div>
      <div className="truncate text-[12.5px] font-semibold">{block.titel}</div>
      <div className="truncate text-[11px] text-muted">
        {block.vorgangNummer ??
          (block.anzahlStopps > 0
            ? `${block.anzahlStopps} Stopps · ohne Vorgang`
            : (block.notiz ?? "ohne Vorgang"))}
      </div>
    </>
  );

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px) rotate(3deg)` }
          : undefined
      }
      {...attributes}
      {...listeners}
      className={[
        "mb-[6px] rounded-input px-[10px] py-[7px]",
        ART_STIL[block.art] ?? ART_STIL.intern!,
        ziehbar ? "cursor-grab touch-none active:cursor-grabbing" : "",
        isDragging ? "relative z-20 shadow-soft" : "",
      ].join(" ")}
    >
      {/*
        Der Klick öffnet den Einsatz, nicht den Vorgang.
        Vorher sprang man in den Auftrag — und wer den Termin verschieben,
        jemanden austauschen oder den Einsatz absagen wollte, war auf der
        falschen Seite und musste zurück. Was man an der Plantafel tut,
        gehört an die Plantafel. Der Weg zum Vorgang steht im Fenster.

        Der Knopf liegt innen und nicht auf dem ganzen Block: sonst
        öffnete jedes Ziehen das Fenster.
      */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => oeffnen(block.id)}
        data-testid={`einsatz-${block.id}`}
        className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left text-inherit"
      >
        {inhalt}
      </button>
    </div>
  );
}

export type { EinsatzKonflikt };
