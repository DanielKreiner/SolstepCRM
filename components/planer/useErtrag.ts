"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  anlagenErtrag,
  type AnlagenErtrag,
  type ErtragAntwort,
  type Quelle,
  zwischenwert,
} from "@/lib/planer/ertrag";
import { ausrichtungen, kwp } from "@/lib/planer/module";
import type { Plan } from "@/lib/planer/plan";
import {
  anlagenVerschattung,
  type VerschattungErgebnis,
} from "@/lib/planer/verschattung";

/*
 * Ertrag der geplanten Anlage, laufend nachgeführt (Briefing 6).
 *
 * Jede Fläche hat ihre eigene Neigung und Ausrichtung und damit ihren
 * eigenen spezifischen Ertrag; die Gruppen darauf werden mit ihrer
 * Leistung gewichtet aufsummiert. Ein Ost-West-Dach darf NICHT über
 * einen gemittelten Azimut gerechnet werden — Ost und West mitteln sich
 * rechnerisch zu Süd und das Ergebnis läge zwölf Prozent zu hoch.
 *
 * Beim Ziehen an einem Regler wird nicht bei jedem Pixel gefragt: die
 * Anfrage läuft erst 800 ms nach der letzten Änderung. Bis dahin bleibt
 * die Anzeige nicht stehen, sondern rechnet aus dem letzten Wert weiter
 * — sichtbar an der Tilde vor der Zahl.
 */

const WARTEZEIT_MS = 800;

export interface ErtragStand {
  anlage: AnlagenErtrag;
  /**
   * Ertragsfaktor aus der Verschattung, 1 heisst unverschattet.
   * Getrennt ausgewiesen, damit im Angebot sichtbar bleibt, wie viel
   * Ertrag ein Baum kostet — als versteckter Abschlag wäre die Zahl
   * nicht zu vertreten.
   */
  schattenFaktor: number;
  /**
   * Verschattung je Modul, Schlüssel wie im Stringmalen (`gruppe/reihe:spalte`).
   * Damit färbt die Zeichenfläche die betroffenen Module ein — eine
   * Prozentzahl allein sagt niemandem, WELCHE Module der Baum trifft.
   */
  schattenJeModul: Map<string, VerschattungErgebnis>;
  /** Woher die Zahlen kommen; "geschaetzt" heisst PVGIS war nicht erreichbar. */
  quelle: Quelle;
  /** Zwischenwert aus dem letzten Abruf hochgerechnet — mit „~" anzeigen. */
  vorlaeufig: boolean;
  laedt: boolean;
}

interface FlaechenStand {
  antwort: ErtragAntwort;
  azimut: number;
  neigung: number;
}

/** Schlüssel des Ertragsspeichers: die Ausrichtung selbst. */
function ausrichtungsSchluessel(azimut: number, neigung: number): string {
  return `${Math.round(azimut)}|${Math.round(neigung)}`;
}

const LEER: AnlagenErtrag = {
  kwp: 0,
  jahresertragKwh: 0,
  spezifischMittel: 0,
  monateKwh: Array(12).fill(0),
};

export function useErtrag(
  plan: Plan,
  ursprung: { lat: number; lon: number },
  verlustProzent: number,
  /** Höhe der Traufe über dem Gelände — bestimmt, was ein Baum verdeckt. */
  hoeheUeberGelaende = 3,
): ErtragStand {
  /*
   * Die Antworten liegen in einem Ref, nicht im State: sie kommen
   * asynchron und je Fläche einzeln herein, und jede einzelne
   * Zustandsänderung würde eine Neuberechnung der ganzen Anlage
   * auslösen. Der Zähler unten stösst genau EINE Neuberechnung an,
   * wenn eine Antwort da ist.
   */
  const antworten = useRef<Map<string, FlaechenStand>>(new Map());
  const [runde, setRunde] = useState(0);
  const [laedt, setLaedt] = useState(false);

  /*
   * Die Ausrichtungen als Zeichenkette: nur wenn sich Neigung oder
   * Azimut einer Fläche wirklich ändert, wird neu geholt. Ein
   * verschobenes Modul ändert die Ausrichtung nicht.
   */
  /*
   * Abbild der Belegung für den Verschattungs-Speicher. Über die
   * Gruppenzahl allein liesse sich nicht erkennen, dass ein Modul
   * abgeschaltet wurde.
   */
  const abbildDerModule = plan.gruppen
    .map((g) => `${g.id}:${g.reihen}x${g.spalten}:${g.aus.length}:${g.anker.x.toFixed(2)}`)
    .join("|");

  /*
   * Welche Ausrichtungen die Anlage überhaupt hat.
   *
   * Nicht mehr je Dachfläche: Ein aufgeständertes Flachdach schaut
   * dorthin, wo das Gestell hinzeigt — bei Ost/West in ZWEI Richtungen.
   * Der Ertrag wird deshalb je Ausrichtung geholt und mit der jeweiligen
   * Leistung gewichtet. Ein Mittelwert aus Ost und West wäre Süden und
   * läge über zehn Prozent zu hoch.
   */
  const anteile = plan.gruppen.flatMap((g) => {
    const f = plan.flaechen.find((x) => x.id === g.flaeche);
    if (!f) return [];
    const leistung = kwp(g);
    return ausrichtungen(g, f).map((a) => ({
      kwp: leistung * a.anteil,
      azimut: Math.round(a.azimut),
      neigung: Math.round(a.neigung),
    }));
  });

  const gebraucht = [...new Set(anteile.map((a) => ausrichtungsSchluessel(a.azimut, a.neigung)))]
    .sort()
    .join(";");

  useEffect(() => {
    const noetig = gebraucht ? gebraucht.split(";") : [];
    if (noetig.length === 0) return;

    let abgebrochen = false;
    const uhr = setTimeout(async () => {
      setLaedt(true);
      await Promise.all(
        noetig.map(async (schluessel) => {
          const [azimutText, neigungText] = schluessel.split("|");
          const azimut = Number(azimutText);
          const neigung = Number(neigungText);
          if (!Number.isFinite(azimut) || !Number.isFinite(neigung)) return;
          if (antworten.current.has(schluessel)) return;

          const url =
            `/api/planer/ertrag?lat=${ursprung.lat}&lon=${ursprung.lon}` +
            `&azimut=${azimut}&neigung=${neigung}&verlust=${verlustProzent}`;
          try {
            const antwort = await fetch(url);
            if (!antwort.ok || abgebrochen) return;
            const daten = (await antwort.json()) as ErtragAntwort;
            antworten.current.set(schluessel, { antwort: daten, azimut, neigung });
          } catch {
            /*
             * Netz weg: den letzten bekannten Wert stehen lassen. Ein
             * Planer, der bei jedem Wackler seine Zahlen verliert, ist
             * beim Kunden am Tisch schlimmer als einer mit einem etwas
             * alten Wert.
             */
          }
        }),
      );
      if (!abgebrochen) {
        setLaedt(false);
        setRunde((r) => r + 1);
      }
    }, WARTEZEIT_MS);

    return () => {
      abgebrochen = true;
      clearTimeout(uhr);
    };
  }, [gebraucht, ursprung.lat, ursprung.lon, verlustProzent]);

  /*
   * Aus den vorliegenden Antworten die Anlage rechnen. Flächen, deren
   * Antwort noch nicht da ist oder deren Ausrichtung sich gerade
   * geändert hat, werden aus dem letzten Wert hochgerechnet.
   */
  void runde;
  let vorlaeufig = false;
  let irgendwasGeschaetzt = false;

  const gruppen = anteile.flatMap((a) => {
    const stand = antworten.current.get(ausrichtungsSchluessel(a.azimut, a.neigung));
    if (!stand) {
      /*
       * Für diese Ausrichtung ist noch keine Antwort da. Statt sie
       * wegzulassen — die Anlage wäre dann sprunghaft kleiner — wird
       * aus einer vorhandenen hochgerechnet.
       */
      const irgendeine = [...antworten.current.values()][0];
      if (!irgendeine) return [];
      vorlaeufig = true;
      const antwort = zwischenwert(
        irgendeine.antwort,
        { azimut: irgendeine.azimut, neigung: irgendeine.neigung },
        { azimut: a.azimut, neigung: a.neigung },
      );
      return [{ kwp: a.kwp, spezifisch: antwort.spezifisch, monate: antwort.monate }];
    }
    if (stand.antwort.quelle === "geschaetzt") irgendwasGeschaetzt = true;
    return [{ kwp: a.kwp, spezifisch: stand.antwort.spezifisch, monate: stand.antwort.monate }];
  });

  /*
   * Verschattung. Die Rechnung ist geometrisch und läuft über alle
   * Module und Stichzeitpunkte — nur dann, wenn es überhaupt Objekte
   * gibt, sonst wäre es verschwendete Zeit bei jedem Tastendruck.
   */
  const schatten = useMemo<{ faktor: number; jeModul: Map<string, VerschattungErgebnis> }>(
    /*
     * Gerechnet wird in `anlagenVerschattung` — derselben Funktion, die
     * das PDF benutzt. Der Hook hält nur das Ergebnis fest, damit die
     * Rechnung nicht bei jedem Tastendruck erneut über alle Module und
     * Stichzeitpunkte läuft.
     */
    () => anlagenVerschattung(plan, ursprung, hoeheUeberGelaende),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(plan.objekte), abbildDerModule, hoeheUeberGelaende, ursprung.lat, ursprung.lon],
  );

  const schattenFaktor = schatten.faktor;

  const anlage = gruppen.length > 0 ? anlagenErtrag(gruppen) : LEER;

  return {
    /*
     * Der Schatten wirkt auf den Jahresertrag und die Monatswerte
     * gleichermassen. Eine Verteilung über die Monate wäre genauer —
     * Winterschatten wiegt schwerer —, aber die Stichpunkte gewichten
     * das schon; hier noch einmal zu verteilen würde doppelt zählen.
     */
    anlage: {
      ...anlage,
      jahresertragKwh: anlage.jahresertragKwh * schattenFaktor,
      spezifischMittel: anlage.spezifischMittel * schattenFaktor,
      monateKwh: anlage.monateKwh.map((m) => m * schattenFaktor),
    },
    schattenFaktor,
    schattenJeModul: schatten.jeModul,
    quelle: irgendwasGeschaetzt ? "geschaetzt" : "pvgis",
    vorlaeufig,
    laedt,
  };
}
