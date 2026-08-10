"use client";

import { useEffect, useRef, useState } from "react";
import {
  anlagenErtrag,
  type AnlagenErtrag,
  type ErtragAntwort,
  type Quelle,
  zwischenwert,
} from "@/lib/planer/ertrag";
import { kwp } from "@/lib/planer/module";
import type { Plan } from "@/lib/planer/plan";

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
  const ausrichtungen = plan.flaechen
    .map((f) => `${f.id}:${Math.round(f.azimut)}:${Math.round(f.neigung)}`)
    .join("|");

  useEffect(() => {
    const flaechen = ausrichtungen ? ausrichtungen.split("|") : [];
    if (flaechen.length === 0) return;

    let abgebrochen = false;
    const uhr = setTimeout(async () => {
      setLaedt(true);
      await Promise.all(
        flaechen.map(async (eintrag) => {
          const [id, azimutText, neigungText] = eintrag.split(":");
          if (!id) return;
          const azimut = Number(azimutText);
          const neigung = Number(neigungText);

          const bekannt = antworten.current.get(id);
          if (bekannt && bekannt.azimut === azimut && bekannt.neigung === neigung) return;

          const url =
            `/api/planer/ertrag?lat=${ursprung.lat}&lon=${ursprung.lon}` +
            `&azimut=${azimut}&neigung=${neigung}&verlust=${verlustProzent}`;
          try {
            const antwort = await fetch(url);
            if (!antwort.ok || abgebrochen) return;
            const daten = (await antwort.json()) as ErtragAntwort;
            antworten.current.set(id, { antwort: daten, azimut, neigung });
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
  }, [ausrichtungen, ursprung.lat, ursprung.lon, verlustProzent]);

  /*
   * Aus den vorliegenden Antworten die Anlage rechnen. Flächen, deren
   * Antwort noch nicht da ist oder deren Ausrichtung sich gerade
   * geändert hat, werden aus dem letzten Wert hochgerechnet.
   */
  void runde;
  let vorlaeufig = false;
  let irgendwasGeschaetzt = false;

  const gruppen = plan.gruppen.flatMap((g) => {
    const flaeche = plan.flaechen.find((f) => f.id === g.flaeche);
    const stand = flaeche ? antworten.current.get(flaeche.id) : undefined;
    if (!flaeche || !stand) return [];

    const jetzt = { azimut: Math.round(flaeche.azimut), neigung: Math.round(flaeche.neigung) };
    const passt = stand.azimut === jetzt.azimut && stand.neigung === jetzt.neigung;
    if (!passt) vorlaeufig = true;
    if (stand.antwort.quelle === "geschaetzt") irgendwasGeschaetzt = true;

    const antwort = passt
      ? stand.antwort
      : zwischenwert(stand.antwort, { azimut: stand.azimut, neigung: stand.neigung }, jetzt);

    return [{ kwp: kwp(g), spezifisch: antwort.spezifisch, monate: antwort.monate }];
  });

  return {
    anlage: gruppen.length > 0 ? anlagenErtrag(gruppen) : LEER,
    quelle: irgendwasGeschaetzt ? "geschaetzt" : "pvgis",
    vorlaeufig,
    laedt,
  };
}
