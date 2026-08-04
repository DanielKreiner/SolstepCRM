"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LEER, Meldung, type AktionsStatus } from "@/components/ui/Formular";
import { Suchauswahl, type Option } from "@/components/ui/Suchauswahl";
import {
  Positionsleiste,
  type Produkt,
  type VorlageOption,
} from "./Positionsleiste";
import { eur, num } from "@/lib/format";
import { berechne, type PreisGruppe, type PreisPosition } from "@/lib/vorgang/preis";
import {
  angebotskopfSpeichern,
  gruppeAendern,
  gruppeAufloesen,
  positionAendern,
  positionLoeschen,
  positionOptional,
  positionVerschieben,
  positionWeg,
  positionZuordnen,
  upgradeSetzen,
} from "@/app/(app)/vorgaenge/positionen-actions";

/*
 * Ohne Gruppe ist auch ein Ablageziel. dnd-kit braucht dafür eine ID,
 * und ein leerer String ist keine.
 */
const OHNE = "ohne-gruppe";

const HINWEIS = {
  draggable:
    "Mit Leertaste aufnehmen, mit den Pfeiltasten verschieben, mit Leertaste ablegen, mit Escape abbrechen.",
};

/**
 * Wohin fällt die Position.
 *
 * Erst danach fragen, worüber der Zeiger wirklich steht — die Gruppen
 * liegen ineinander verschachtelt, und die reine Eckendistanz greift
 * dann daneben: eine auf die Gruppenkopfzeile gezogene Position landete
 * bei den Einzelpositionen, weil deren Fläche zufällig näher lag.
 *
 * Ohne Zeiger — beim Verschieben mit der Tastatur — bleibt die
 * Eckendistanz, die dafür genau richtig ist.
 */
const treffer: typeof closestCorners = (args) => {
  const unterZeiger = pointerWithin(args);
  return unterZeiger.length > 0 ? unterZeiger : closestCorners(args);
};

const ANSAGEN = {
  onDragStart: ({ active }: { active: { id: string | number } }) =>
    `Position ${active.id} aufgenommen.`,
  onDragOver: ({ over }: { over: { id: string | number } | null }) =>
    over ? "Über einem möglichen Ziel." : "Ausserhalb jeder Liste.",
  onDragEnd: ({ over }: { over: { id: string | number } | null }) =>
    over ? "Abgelegt." : "Nicht abgelegt, die Position blieb, wo sie war.",
  onDragCancel: () => "Abgebrochen, nichts verschoben.",
};

export type GruppeAnzeige = {
  id: string;
  name: string;
  beschreibung: string | null;
  sort: number;
  paketPreis: number | null;
  einzelpreiseVerstecken: boolean;
};

export type PositionAnzeige = {
  id: string;
  sort: number;
  gruppeId: string | null;
  optional: boolean;
  rabattProzent: number;
  upgradeArticleId: string | null;
  upgradeKategorie: string | null;
  upgradeAufpreis: number | null;
  upgradeText: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  epNetto: number;
  ustSatz: number;
  kalkStunden: number | null;
  kalkEk: number | null;
  istMaterial: boolean;
  bildUrl: string | null;
};

/**
 * Der Angebotseditor — im Vorgang, nicht daneben.
 *
 * Positionen zusammenstellen, Summen live, Kalkulation sichtbar. Wer ein
 * Angebot baut, wechselt dabei nicht die Seite: der Kunde ist am Telefon
 * und fragt, was die Wallbox extra kostet.
 */
export function Positionen({
  vorgangId,
  positionen,
  gruppen,
  rahmen,
  artikel,
  kategorien,
  produkte,
  vorlagen,
  einheiten,
  gesperrt,
  gesperrtGrund,
}: {
  vorgangId: string;
  positionen: PositionAnzeige[];
  gruppen: GruppeAnzeige[];
  rahmen: { ustSatz: number; rabattProzent: number; lieferungNetto: number };
  artikel: Option[];
  /** Kategorien des Artikelstamms — für Kategorie-Upgrades. */
  kategorien: string[];
  /** Der Katalog für das Produktfenster — mit Bild, Hersteller, EK und VK. */
  produkte: Produkt[];
  vorlagen: VorlageOption[];
  einheiten: string[];
  gesperrt: boolean;
  gesperrtGrund: string | null;
}) {
  /*
   * Die Reihenfolge liegt lokal, damit eine gezogene Zeile sofort liegen
   * bleibt, wo sie hingehört, und nicht erst nach der Serverantwort
   * zurückspringt. Der Server bleibt die Wahrheit — kommen neue Daten,
   * gewinnen sie.
   */
  const [liste, setListe] = useState(positionen);
  const [warten, uebergang] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => setListe(positionen), [positionen]);

  const sensoren = useSensors(
    /*
     * Erst ab 6 Pixeln ist es ein Ziehen. Ohne diese Schwelle wird jeder
     * Klick auf eine Zeile zum Drag, und die Zeile klappt nie mehr auf.
     */
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function behaelter(id: string): string {
    if (id === OHNE || gruppen.some((g) => g.id === id)) return id;
    const p = liste.find((x) => x.id === id);
    return p?.gruppeId && gruppen.some((g) => g.id === p.gruppeId)
      ? p.gruppeId
      : OHNE;
  }

  function abgelegt(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;

    const id = String(active.id);
    const ziel = behaelter(String(over.id));
    const quelle = behaelter(id);
    if (ziel === quelle && String(over.id) === id) return;

    const gruppeId = ziel === OHNE ? null : ziel;

    /* Neue Reihenfolge der Zielspalte bestimmen. */
    const ohneMich = liste.filter((p) => p.id !== id);
    const inZiel = ohneMich.filter((p) => behaelterVon(p, gruppen) === ziel);
    const stelle =
      String(over.id) === ziel
        ? inZiel.length
        : Math.max(0, inZiel.findIndex((p) => p.id === String(over.id)));

    const bewegt = liste.find((p) => p.id === id);
    if (!bewegt) return;

    const neuInZiel = [...inZiel];
    neuInZiel.splice(stelle, 0, { ...bewegt, gruppeId });

    setListe([
      ...ohneMich.filter((p) => behaelterVon(p, gruppen) !== ziel),
      ...neuInZiel,
    ]);

    setFehler(null);
    uebergang(async () => {
      const r = await positionVerschieben({
        vorgangId,
        positionId: id,
        gruppeId,
        reihenfolge: neuInZiel.map((p) => p.id),
      });
      if (r.error) {
        setFehler(r.error);
        setListe(positionen);
      }
    });
  }

  function optionalUmschalten(p: PositionAnzeige) {
    setListe((l) =>
      l.map((x) => (x.id === p.id ? { ...x, optional: !x.optional } : x)),
    );
    setFehler(null);
    uebergang(async () => {
      const r = await positionOptional({
        vorgangId,
        positionId: p.id,
        optional: !p.optional,
      });
      if (r.error) {
        setFehler(r.error);
        setListe(positionen);
      }
    });
  }

  function entfernen(p: PositionAnzeige) {
    setListe((l) => l.filter((x) => x.id !== p.id));
    setFehler(null);
    uebergang(async () => {
      const r = await positionWeg({ vorgangId, positionId: p.id });
      if (r.error) {
        setFehler(r.error);
        setListe(positionen);
      }
    });
  }

  const werkzeug: Werkzeug = {
    optionalUmschalten,
    entfernen,
    ziehbar: !gesperrt,
  };

  const preisPositionen: PreisPosition[] = liste.map((p) => ({
    id: p.id,
    gruppeId: p.gruppeId,
    menge: p.menge,
    epNetto: p.epNetto,
    rabattProzent: p.rabattProzent,
    optional: p.optional,
    kalkEk: p.kalkEk,
  }));
  const preisGruppen: PreisGruppe[] = gruppen.map((g) => ({
    id: g.id,
    paketPreis: g.paketPreis,
  }));
  const preis = berechne(preisPositionen, preisGruppen, rahmen);

  const gruppenWahl = [
    { wert: "", text: "— ohne Gruppe —" },
    ...gruppen.map((g) => ({ wert: g.id, text: g.name })),
  ];
  const frei = liste.filter(
    (p) => !p.gruppeId || !gruppen.some((g) => g.id === p.gruppeId),
  );

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      {/*
        Die Werkzeuge stehen oben, nicht unter der Liste. Je voller das
        Angebot, desto weiter weg war der Knopf zum Hinzufügen — genau
        verkehrt herum.
      */}
      {!gesperrt ? (
        <Positionsleiste
          vorgangId={vorgangId}
          anzahl={liste.length}
          produkte={produkte}
          vorlagen={vorlagen}
          einheiten={einheiten}
        />
      ) : (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Positionen</h2>
          <span className="num text-[11.5px] text-faint">
            {liste.length} {liste.length === 1 ? "Position" : "Positionen"}
          </span>
        </div>
      )}

      {warten ? (
        <p className="mb-2 text-[11.5px] text-faint">wird gespeichert …</p>
      ) : null}

      {gesperrt ? (
        <p className="mb-4 rounded-input bg-panel px-4 py-3 text-[12.5px] text-muted">
          {gesperrtGrund}
        </p>
      ) : null}

      {fehler ? (
        <p className="mb-3 rounded-input bg-s-crit/10 px-4 py-3 text-[12.5px] text-s-crit">
          {fehler}
        </p>
      ) : null}

      {liste.length === 0 && gruppen.length === 0 ? (
        <p className="rounded-input bg-panel px-4 py-6 text-center text-[13px] text-muted">
          Noch nichts drin. Artikel suchen oder eine freie Position anlegen —
          für Montage, Anfahrt, Gerüst.
        </p>
      ) : null}

      {/*
        Feste id: ohne sie zählt dnd-kit die Beschreibungs-IDs auf Server
        und Client getrennt hoch, und React verwirft die Hydrierung mit
        einer Attributabweichung.

        Ansagen auf Deutsch, weil die Voreinstellung englisch ist und die
        Regel für alle Texte gilt — auch für die, die nur vorgelesen
        werden (Abschnitt 10).
      */}
      <DndContext
        id="angebotspositionen"
        sensors={sensoren}
        collisionDetection={treffer}
        onDragEnd={abgelegt}
        accessibility={{ announcements: ANSAGEN, screenReaderInstructions: HINWEIS }}
      >
        {/* --------------------------------------------------- GRUPPEN */}
        {gruppen.map((g) => (
          <GruppenBlock
            key={g.id}
            vorgangId={vorgangId}
            gruppe={g}
            positionen={liste.filter((p) => p.gruppeId === g.id)}
            gruppenWahl={gruppenWahl}
            artikel={artikel}
            kategorien={kategorien}
            gesperrt={gesperrt}
            werkzeug={werkzeug}
            netto={
              berechne(
                preisPositionen,
                [{ id: g.id, paketPreis: g.paketPreis }],
                { ...rahmen, rabattProzent: 0, lieferungNetto: 0 },
              ).positionenNetto
            }
          />
        ))}

        {/* --------------------------------------- FREIE EINZELPOSITIONEN */}
        <Ablage id={OHNE}>
          {gruppen.length > 0 ? (
            <p className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-faint uppercase">
              Einzelpositionen
            </p>
          ) : null}
          <SortableContext
            items={frei.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-2">
              {frei.map((p, i) => (
                <Zeile
                  key={p.id}
                  vorgangId={vorgangId}
                  position={p}
                  nummer={(i + 1) * 10}
                  gruppenWahl={gruppenWahl}
                  artikel={artikel}
                  kategorien={kategorien}
                  gesperrt={gesperrt}
                  werkzeug={werkzeug}
                />
              ))}
            </ul>
          </SortableContext>
          {frei.length === 0 && gruppen.length > 0 ? (
            <p className="rounded-input border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-faint">
              Hierher ziehen, um eine Position aus ihrer Gruppe zu nehmen.
            </p>
          ) : null}
        </Ablage>
      </DndContext>

      {/* ------------------------------------------------------ SUMMEN */}
      <dl className="mt-4 flex flex-col gap-[7px] border-t border-line pt-4 text-[13px]">
        <Summe label="Positionen netto" wert={eur(preis.positionenNetto)} leise />
        {preis.gesamtRabatt > 0 ? (
          <Summe
            label={`Rabatt ${num(rahmen.rabattProzent)} %`}
            wert={`− ${eur(preis.gesamtRabatt)}`}
            leise
          />
        ) : null}
        <Summe label="Netto" wert={eur(preis.netto)} />
        <Summe
          label={`Umsatzsteuer ${num(rahmen.ustSatz)} %`}
          wert={eur(preis.ust)}
          leise
        />
        {preis.lieferungNetto > 0 ? (
          <Summe
            label="Lieferung (inkl. USt.)"
            wert={eur(preis.lieferungBrutto)}
            leise
          />
        ) : null}
        <Summe label="Gesamt brutto" wert={eur(preis.gesamt)} stark />
        {preis.optionalNetto > 0 ? (
          <Summe
            label="Optionen, falls gewählt"
            wert={`+ ${eur(preis.optionalNetto)}`}
            leise
          />
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-[11.5px] text-faint">
          <span className="num">Einkauf {eur(preis.ek)}</span>
          <span
            className={`num ${preis.margeProzent < 10 ? "font-semibold text-s-crit" : ""}`}
            title="Deckungsbeitrag auf den Nettoumsatz"
          >
            Marge {eur(preis.marge)} ({num(preis.margeProzent)} %)
          </span>
        </div>
      </dl>

      {/*
        Steuer, Rabatt und Lieferung bleiben unten: sie gehören zu den
        Summen darüber und werden einmal je Angebot gesetzt, nicht bei
        jeder Position.
      */}
      {!gesperrt ? (
        <div className="mt-4 border-t border-line pt-4">
          <RahmenForm vorgangId={vorgangId} rahmen={rahmen} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Was eine Zeile ohne Aufklappen können muss.
 *
 * Als Bündel durchgereicht statt als drei Einzelprops: die Zeile steckt
 * zwei Ebenen tief, und drei Handreichungen durch zwei Komponenten sind
 * schwerer zu lesen als eine.
 */
type Werkzeug = {
  optionalUmschalten: (p: PositionAnzeige) => void;
  entfernen: (p: PositionAnzeige) => void;
  ziehbar: boolean;
};

/** In welchen Behälter gehört die Position — Gruppe oder „ohne". */
function behaelterVon(p: PositionAnzeige, gruppen: GruppeAnzeige[]): string {
  return p.gruppeId && gruppen.some((g) => g.id === p.gruppeId)
    ? p.gruppeId
    : OHNE;
}

/** Ablagefläche. Hebt sich sichtbar an, sobald etwas darüber schwebt. */
function Ablage({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={[
        "mt-3 rounded-input p-1 transition-colors duration-200",
        isOver ? "bg-accent/8 ring-1 ring-accent" : "",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function Summe({
  label,
  wert,
  leise = false,
  stark = false,
}: {
  label: string;
  wert: string;
  leise?: boolean;
  stark?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={leise ? "text-muted" : ""}>{label}</dt>
      <dd
        className={`num ${stark ? "text-[15px] font-bold" : leise ? "text-muted" : "font-medium"}`}
      >
        {wert}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------- ZEILE */

function Zeile({
  vorgangId,
  position,
  nummer,
  gruppenWahl,
  artikel,
  kategorien,
  gesperrt,
  werkzeug,
}: {
  vorgangId: string;
  position: PositionAnzeige;
  nummer: number;
  gruppenWahl: { wert: string; text: string }[];
  artikel: Option[];
  kategorien: string[];
  gesperrt: boolean;
  werkzeug: Werkzeug;
}) {
  const [offen, setOffen] = useState(false);
  const [fragt, setFragt] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: position.id, disabled: !werkzeug.ziehbar });

  const zeile =
    position.menge * position.epNetto * (1 - position.rabattProzent / 100);
  const marge =
    position.epNetto > 0 && position.kalkEk !== null
      ? ((position.epNetto - position.kalkEk) / position.epNetto) * 100
      : null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      /* Anheben mit leichter Neigung, wie überall im Haus (Abschnitt 9). */
      className={[
        "rounded-input bg-panel",
        isDragging ? "relative z-10 rotate-[3deg] shadow-soft" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 px-3 py-[10px]">
        {werkzeug.ziehbar ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`${position.bezeichnung} verschieben`}
            title="Ziehen — in eine Gruppe oder heraus"
            className="shrink-0 cursor-grab touch-none rounded-[6px] border-0 bg-transparent px-1 py-2 text-faint hover:text-ink active:cursor-grabbing"
          >
            <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden fill="currentColor">
              <circle cx="2" cy="3" r="1.4" /><circle cx="8" cy="3" r="1.4" />
              <circle cx="2" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" />
              <circle cx="2" cy="13" r="1.4" /><circle cx="8" cy="13" r="1.4" />
            </svg>
          </button>
        ) : null}

        <button
          type="button"
          disabled={gesperrt}
          onClick={() => setOffen((o) => !o)}
          aria-expanded={offen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left disabled:cursor-default"
        >
          <span className="num w-[26px] shrink-0 text-[11px] text-faint">{nummer}</span>

          {position.bildUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={position.bildUrl}
              alt=""
              loading="lazy"
              className="h-[32px] w-[32px] shrink-0 rounded-[8px] bg-surface object-contain"
            />
          ) : null}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium">
              {position.bezeichnung}
            </span>
            <span className="num block text-[11px] text-faint">
              {num(position.menge)} {position.einheit} × {eur(position.epNetto)}
              {position.rabattProzent > 0
                ? ` · −${num(position.rabattProzent)} %`
                : ""}
              {marge !== null ? ` · DB ${Math.round(marge)} %` : ""}
              {position.istMaterial ? " · Material" : " · Leistung"}
            </span>
          </span>

          {position.upgradeAufpreis !== null ? (
            <span
              className="num shrink-0 rounded-pill bg-s-warn/14 px-[8px] py-px text-[10px] font-semibold text-accent-ink"
              title="Der Kunde kann auf ein besseres Produkt wechseln"
            >
              +{eur(position.upgradeAufpreis)}
            </span>
          ) : null}

          <span className="num shrink-0 text-[13.5px] font-semibold">{eur(zeile)}</span>
        </button>

        {/*
          Optional und Löschen stehen in der Liste und nicht im
          Bearbeiten-Formular: beides entscheidet sich beim Durchsehen,
          und dafür jede Zeile aufzuklappen war der halbe Nachmittag.
        */}
        {!gesperrt ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => werkzeug.optionalUmschalten(position)}
              aria-pressed={position.optional}
              title="Optional — der Kunde wählt sie im Portal dazu"
              className={[
                "cursor-pointer rounded-pill px-[9px] py-[3px] text-[10px] font-semibold transition-colors",
                position.optional
                  ? "bg-s-doing/12 text-s-doing"
                  : "border border-line bg-surface text-faint hover:text-ink",
              ].join(" ")}
            >
              optional
            </button>

            {fragt ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => werkzeug.entfernen(position)}
                  className="cursor-pointer rounded-pill bg-s-crit px-[9px] py-[3px] text-[10px] font-semibold text-white"
                >
                  wirklich weg
                </button>
                <button
                  type="button"
                  onClick={() => setFragt(false)}
                  className="cursor-pointer border-0 bg-transparent px-1 text-[10px] text-muted underline"
                >
                  nein
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setFragt(true)}
                aria-label={`${position.bezeichnung} entfernen`}
                title="Position entfernen"
                className="cursor-pointer rounded-pill border border-line bg-surface px-[9px] py-[3px] text-[11px] text-faint transition-colors hover:border-s-crit hover:text-s-crit"
              >
                ✕
              </button>
            )}
          </div>
        ) : null}
      </div>

      {offen && !gesperrt ? (
        <ZeileBearbeiten
          gruppenWahl={gruppenWahl}
          artikel={artikel}
          kategorien={kategorien}
          vorgangId={vorgangId}
          position={position}
          schliessen={() => setOffen(false)}
        />
      ) : null}
    </li>
  );
}

function ZeileBearbeiten({
  vorgangId,
  position,
  gruppenWahl,
  artikel,
  kategorien,
  schliessen,
}: {
  vorgangId: string;
  position: PositionAnzeige;
  gruppenWahl: { wert: string; text: string }[];
  artikel: Option[];
  kategorien: string[];
  schliessen: () => void;
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    positionAendern,
    LEER,
  );
  const [zuordStatus, zuordAction] = useActionState<AktionsStatus, FormData>(
    positionZuordnen,
    LEER,
  );
  const [loeschStatus, loeschAction] = useActionState<AktionsStatus, FormData>(
    positionLoeschen,
    LEER,
  );
  const p = `pz-${position.id.slice(0, 8)}`;

  return (
    <div className="border-t border-line px-3 py-3">
      <form action={formAction} className="grid gap-2 sm:grid-cols-6">
        <input type="hidden" name="vorgangId" value={vorgangId} />
        <input type="hidden" name="positionId" value={position.id} />

        <Feld
          praefix={p}
          label="Bezeichnung"
          name="bezeichnung"
          wert={position.bezeichnung}
          spalten="sm:col-span-6"
        />
        <Feld praefix={p} label="Menge" name="menge" wert={position.menge} typ="number" schritt="0.001" />
        <Feld praefix={p} label="Einheit" name="einheit" wert={position.einheit} />
        <Feld
          praefix={p}
          label="Verkauf netto"
          name="epNetto"
          wert={position.epNetto}
          typ="number"
          schritt="0.01"
        />
        <Feld
          praefix={p}
          label="Einkauf"
          name="kalkEk"
          wert={position.kalkEk ?? ""}
          typ="number"
          schritt="0.01"
        />
        <Feld
          praefix={p}
          label="Stunden"
          name="kalkStunden"
          wert={position.kalkStunden ?? ""}
          typ="number"
          schritt="0.001"
        />
        <Feld praefix={p} label="USt %" name="ustSatz" wert={position.ustSatz} typ="number" schritt="1" />
        <Feld
          praefix={p}
          label="Rabatt %"
          name="rabattProzent"
          wert={position.rabattProzent}
          typ="number"
          schritt="0.5"
        />

        <label className="flex items-center gap-2 text-[12px] sm:col-span-3">
          <input
            type="checkbox"
            name="istMaterial"
            value="ja"
            defaultChecked={position.istMaterial}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Material — zählt in die Bedarfsliste
        </label>

        {/*
          Optional heisst: zählt erst, wenn der Kunde im Portal das
          Häkchen setzt. Vorher wäre der Preis höher, als das Angebot
          verspricht.
        */}
        <label className="flex items-center gap-2 text-[12px] sm:col-span-3">
          <input
            type="checkbox"
            name="optional"
            value="ja"
            defaultChecked={position.optional}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Optional — der Kunde wählt sie dazu
        </label>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-6">
          <Klein label="Speichern" />
          <button
            type="button"
            onClick={schliessen}
            className="cursor-pointer border-0 bg-transparent text-[12px] text-muted underline"
          >
            Schliessen
          </button>
        </div>
      </form>

      {/*
        Eigenes Formular: verschachtelte wirft der Browser weg, und der
        innere Knopf löste dann den äusseren Vorgang aus.
      */}
      {gruppenWahl.length > 1 ? (
        <form action={zuordAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="vorgangId" value={vorgangId} />
          <input type="hidden" name="positionId" value={position.id} />
          <label htmlFor={`${p}-gruppe`} className="text-[11.5px] text-muted">
            Gruppe
          </label>
          <select
            id={`${p}-gruppe`}
            name="gruppeId"
            defaultValue={position.gruppeId ?? ""}
            className="rounded-input border border-line bg-surface px-[10px] py-[6px] text-[12px]"
          >
            {gruppenWahl.map((g) => (
              <option key={g.wert} value={g.wert}>
                {g.text}
              </option>
            ))}
          </select>
          <Klein label="Verschieben" />
          <Meldung status={zuordStatus} />
        </form>
      ) : null}

      <UpgradeForm
        vorgangId={vorgangId}
        position={position}
        artikel={artikel}
        kategorien={kategorien}
        praefix={p}
      />

      <form action={loeschAction} className="mt-2">
        <input type="hidden" name="vorgangId" value={vorgangId} />
        <input type="hidden" name="positionId" value={position.id} />
        <button
          type="submit"
          className="cursor-pointer border-0 bg-transparent text-[12px] font-medium text-s-crit underline"
        >
          Position entfernen
        </button>
      </form>

      <Meldung status={status} />
      <Meldung status={loeschStatus} />
    </div>
  );
}

function Feld({
  label,
  name,
  wert,
  typ = "text",
  schritt,
  spalten = "",
  praefix,
}: {
  label: string;
  name: string;
  wert: string | number;
  typ?: string;
  schritt?: string;
  spalten?: string;
  /*
   * Eindeutig je Formular. Auf der Seite stehen der Artikelübernahme-
   * Block, das Formular für freie Positionen und je Zeile ein
   * Bearbeitungsformular — alle mit einem Feld „Menge". Ohne Präfix
   * zeigen mehrere Labels auf dieselbe id, und dann trifft ein Klick
   * aufs Label das falsche Feld.
   */
  praefix: string;
}) {
  const id = `${praefix}-${name}`;
  return (
    <span className={`flex flex-col gap-[3px] ${spalten}`}>
      <label htmlFor={id} className="text-[10.5px] text-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={typ}
        step={schritt}
        defaultValue={wert}
        className="w-full rounded-input border border-transparent bg-surface px-[10px] py-[7px] text-[12.5px] outline-0 focus:border-accent"
      />
    </span>
  );
}

function Klein({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[34px] cursor-pointer rounded-pill border-0 bg-ink px-[16px] text-[12px] font-semibold text-app disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

/* ------------------------------------------------------------ ANLEGEN */

/**
 * Eine Gruppe im Editor.
 *
 * Zeigt oben, was der Kunde sehen wird — Paketpreis oder Summe — und
 * darunter die Positionen, die darin stecken. Die Einstellungen klappen
 * auf: sie werden einmal gesetzt und danach selten angefasst.
 */
function GruppenBlock({
  vorgangId,
  gruppe,
  positionen,
  gruppenWahl,
  artikel,
  kategorien,
  netto,
  gesperrt,
  werkzeug,
}: {
  vorgangId: string;
  gruppe: GruppeAnzeige;
  positionen: PositionAnzeige[];
  gruppenWahl: { wert: string; text: string }[];
  artikel: Option[];
  kategorien: string[];
  netto: number;
  gesperrt: boolean;
  werkzeug: Werkzeug;
}) {
  const [offen, setOffen] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: gruppe.id });
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    gruppeAendern,
    LEER,
  );
  const [aufloesStatus, aufloesAction] = useActionState<AktionsStatus, FormData>(
    gruppeAufloesen,
    LEER,
  );
  const p = `gr-${gruppe.id.slice(0, 8)}`;

  return (
    <section
      ref={setNodeRef}
      className={[
        "mt-3 rounded-input border bg-panel transition-colors duration-200",
        isOver ? "border-accent bg-accent/8" : "border-line",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-[10px]">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">
            {gruppe.name}
          </span>
          <span className="num block text-[11px] text-faint">
            {positionen.length}{" "}
            {positionen.length === 1 ? "Position" : "Positionen"}
            {gruppe.einzelpreiseVerstecken
              ? " · Kunde sieht nur den Paketpreis"
              : ""}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-[10px] tracking-[0.08em] text-faint uppercase">
            {gruppe.paketPreis !== null ? "Paketpreis" : "Summe"}
          </span>
          <span className="num block text-[13.5px] font-semibold">
            {eur(netto)}
          </span>
        </span>

        {!gesperrt ? (
          <button
            type="button"
            onClick={() => setOffen((o) => !o)}
            aria-expanded={offen}
            className="shrink-0 cursor-pointer rounded-pill border border-line bg-surface px-[11px] py-[5px] text-[11.5px] font-medium"
          >
            {offen ? "Fertig" : "Ändern"}
          </button>
        ) : null}
      </div>

      {offen && !gesperrt ? (
        <div className="border-t border-line px-3 py-3">
          <form action={formAction} className="grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="gruppeId" value={gruppe.id} />

            <Feld
              praefix={p}
              label="Name"
              name="name"
              wert={gruppe.name}
              spalten="sm:col-span-2"
            />
            <Feld
              praefix={p}
              label="Paketpreis netto"
              name="paketPreis"
              wert={gruppe.paketPreis ?? ""}
              typ="number"
              schritt="0.01"
            />
            <Feld
              praefix={p}
              label="Beschreibung"
              name="beschreibung"
              wert={gruppe.beschreibung ?? ""}
              spalten="sm:col-span-4"
            />

            <label className="flex items-center gap-2 text-[12px] sm:col-span-4">
              <input
                type="checkbox"
                name="einzelpreiseVerstecken"
                value="ja"
                defaultChecked={gruppe.einzelpreiseVerstecken}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Einzelpreise verstecken — der Kunde sieht nur den Paketpreis
            </label>

            <p className="text-[11px] text-faint sm:col-span-4">
              Leerer Paketpreis heisst: die Positionen zählen sich selbst
              zusammen.
            </p>

            <div className="sm:col-span-4">
              <Klein label="Speichern" />
              <Meldung status={status} />
            </div>
          </form>

          <form action={aufloesAction} className="mt-2">
            <input type="hidden" name="vorgangId" value={vorgangId} />
            <input type="hidden" name="gruppeId" value={gruppe.id} />
            <button
              type="submit"
              className="cursor-pointer border-0 bg-transparent text-[11.5px] text-s-crit underline"
            >
              Gruppe auflösen — die Positionen bleiben
            </button>
            <Meldung status={aufloesStatus} />
          </form>
        </div>
      ) : null}

      {positionen.length > 0 ? (
        <SortableContext
          items={positionen.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-2 px-3 pb-3">
            {positionen.map((pos, i) => (
              <Zeile
                key={pos.id}
                vorgangId={vorgangId}
                position={pos}
                nummer={(i + 1) * 10}
                gruppenWahl={gruppenWahl}
                artikel={artikel}
                kategorien={kategorien}
                gesperrt={gesperrt}
                werkzeug={werkzeug}
              />
            ))}
          </ul>
        </SortableContext>
      ) : (
        <p className="mx-3 mb-3 rounded-input border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-faint">
          Noch nichts in dieser Gruppe. Positionen hierher ziehen.
        </p>
      )}
    </section>
  );
}

/**
 * Steuersatz, Rabatt und Lieferung.
 *
 * Der Steuersatz gilt für das ganze Angebot: eine PV-Anlage nach
 * Deutschland ist vollständig steuerfrei, eine nach Österreich
 * vollständig mit 20 %. Gemischte Sätze gibt es in diesem Geschäft nicht.
 */
function RahmenForm({
  vorgangId,
  rahmen,
}: {
  vorgangId: string;
  rahmen: { ustSatz: number; rabattProzent: number; lieferungNetto: number };
}) {
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    angebotskopfSpeichern,
    LEER,
  );

  return (
    <form action={formAction} className="rounded-input bg-panel p-4">
      <h3 className="text-[13px] font-semibold">Steuer, Rabatt, Lieferung</h3>
      <p className="mt-1 mb-3 text-[11.5px] text-muted">
        Gilt für das ganze Angebot.
      </p>

      <input type="hidden" name="vorgangId" value={vorgangId} />

      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label
            htmlFor="rf-ust"
            className="mb-[5px] block text-[11.5px] font-medium text-muted"
          >
            USt-Satz
          </label>
          <select
            id="rf-ust"
            name="ustSatz"
            defaultValue={String(rahmen.ustSatz)}
            className="w-full rounded-input border border-transparent bg-sunk px-[11px] py-[9px] text-[13px] outline-0 focus:border-accent"
          >
            <option value="0">0 % — Deutschland</option>
            <option value="19">19 %</option>
            <option value="20">20 % — Österreich</option>
          </select>
        </div>
        <Feld
          praefix="rf"
          label="Rabatt %"
          name="rabattProzent"
          wert={rahmen.rabattProzent}
          typ="number"
          schritt="0.5"
        />
        <Feld
          praefix="rf"
          label="Lieferung netto"
          name="lieferungNetto"
          wert={rahmen.lieferungNetto}
          typ="number"
          schritt="0.01"
        />
      </div>

      <div className="mt-3">
        <Klein label="Speichern" />
      </div>
      <Meldung status={status} />
    </form>
  );
}

/* ----------------------------------------------------------- UPGRADE */

/**
 * Ein Upgrade an einer Position.
 *
 * Zwei Formen, weil es zwei Gespräche gibt: „statt der 9er die 12er
 * Batterie" ist ein konkretes Produkt, „einen grösseren Speicher, such
 * dir was aus" ist eine Kategorie.
 *
 * Der Aufpreis ist brutto — das ist die Zahl, die der Kunde sieht. Leer
 * gelassen rechnet die Aktion ihn aus der Preisdifferenz; danach steht
 * er fest, damit ein späterer Artikelpreis kein liegendes Angebot ändert.
 */
function UpgradeForm({
  vorgangId,
  position,
  artikel,
  kategorien,
  praefix,
}: {
  vorgangId: string;
  position: PositionAnzeige;
  artikel: Option[];
  kategorien: string[];
  praefix: string;
}) {
  const [offen, setOffen] = useState(false);
  const [status, formAction] = useActionState<AktionsStatus, FormData>(
    upgradeSetzen,
    LEER,
  );
  const hat = position.upgradeAufpreis !== null;

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="mt-2 cursor-pointer border-0 bg-transparent text-[11.5px] font-medium text-accent-ink underline"
      >
        {hat ? "Upgrade ändern" : "Upgrade anbieten"}
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 grid gap-2 rounded-input bg-sunk p-3">
      <input type="hidden" name="vorgangId" value={vorgangId} />
      <input type="hidden" name="positionId" value={position.id} />

      <p className="text-[11.5px] text-muted">
        Der Kunde sieht das Upgrade im Portal und kann es statt dieser
        Position wählen.
      </p>

      <Suchauswahl
        name="upgradeArticleId"
        label="Statt dessen dieses Produkt"
        breit
        platzhalter="Produkt suchen — leer lassen für eine Kategorie"
        optionen={artikel}
        wert={position.upgradeArticleId}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`${praefix}-ukat`}
            className="mb-[5px] block text-[11.5px] font-medium text-muted"
          >
            oder ganze Kategorie
          </label>
          <select
            id={`${praefix}-ukat`}
            name="upgradeKategorie"
            defaultValue={position.upgradeKategorie ?? ""}
            className="w-full rounded-input border border-transparent bg-surface px-[11px] py-[8px] text-[12.5px] outline-0 focus:border-accent"
          >
            <option value="">—</option>
            {kategorien.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>

        <Feld
          praefix={praefix}
          label="Aufpreis brutto"
          name="upgradeAufpreis"
          wert={position.upgradeAufpreis ?? ""}
          typ="number"
          schritt="0.01"
        />
      </div>

      <Feld
        praefix={praefix}
        label="Text zum Upgrade"
        name="upgradeText"
        wert={position.upgradeText ?? ""}
        spalten="sm:col-span-2"
      />

      <p className="text-[11px] text-faint">
        Aufpreis leer lassen: wird aus der Preisdifferenz gerechnet — nur
        bei einem konkreten Produkt. Produkt und Kategorie beide leer
        entfernt das Upgrade.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Klein label="Speichern" />
        <button
          type="button"
          onClick={() => setOffen(false)}
          className="cursor-pointer border-0 bg-transparent text-[12px] text-muted underline"
        >
          Schliessen
        </button>
      </div>
      <Meldung status={status} />
    </form>
  );
}
