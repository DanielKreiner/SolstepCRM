/*
 * Modulare Speicher — Bausteine statt fertiger Grössen.
 *
 * Fronius Reserva, Huawei LUNA und die meisten Hochvoltspeicher werden
 * nicht als ein Gerät gekauft, sondern als Stapel: eine Steuereinheit
 * (BMS mit Sockel) und darauf mehrere gleiche Module. Wie viele, ist
 * die eigentliche Entscheidung im Verkaufsgespräch — „15 kWh" gibt es
 * nicht, es gibt vier Module à 3,15 kWh, also 12,6 kWh, oder fünf, also
 * 15,8.
 *
 * Der Planer hat das vorher nicht gewusst: er kannte je Speicher genau
 * eine Kapazität. Wer 15 kWh eintrug, bekam eine Wirtschaftlichkeit für
 * eine Grösse, die so nicht bestellbar ist — und in der Stückliste
 * fehlte das BMS, ohne das kein Modul lädt.
 *
 * Reines Rechenmodul: Panel, Stückliste und Angebot rechnen damit
 * dasselbe.
 */

export interface SpeicherTyp {
  id: string;
  hersteller: string;
  bezeichnung: string;
  /** Kapazität eines Geräts bzw. eines Moduls, in kWh. */
  nutzbar_kwh: number;
  /** Gesetzt heisst: Stapel aus Modulen dieser Grösse. */
  modulgroesse_kwh: number | null;
  min_module: number | null;
  max_module: number | null;
  artikel_id: string | null;
  /** Steuereinheit, einmal je Stapel. */
  bms_artikel_id: string | null;
}

export function istModular(s: SpeicherTyp): boolean {
  return (s.modulgroesse_kwh ?? 0) > 0;
}

/** Untere und obere Stapelgrenze, immer sinnvoll besetzt. */
export function grenzen(s: SpeicherTyp): { min: number; max: number } {
  const min = Math.max(1, Math.round(s.min_module ?? 1));
  const max = Math.max(min, Math.round(s.max_module ?? min));
  return { min, max };
}

/**
 * Die Modulzahl, mit der gerechnet wird.
 *
 * Ohne Angabe der kleinste bestellbare Stapel — nicht eins: Ein
 * Reserva-Stapel mit einem Modul lässt sich nicht bestellen, und ein
 * Angebot über etwas Unbestellbares ist schlimmer als eine Vorgabe.
 */
export function modulzahl(s: SpeicherTyp, gewaehlt: number | null | undefined): number {
  const { min, max } = grenzen(s);
  if (!istModular(s)) return 1;
  const n = Math.round(gewaehlt ?? min);
  return Math.min(max, Math.max(min, n));
}

/** Nutzbare Kapazität des Stapels in kWh. */
export function kapazitaet(s: SpeicherTyp, gewaehlt: number | null | undefined): number {
  if (!istModular(s)) return s.nutzbar_kwh;
  const kwh = (s.modulgroesse_kwh ?? s.nutzbar_kwh) * modulzahl(s, gewaehlt);
  return Math.round(kwh * 100) / 100;
}

/**
 * Wie viele Module es für den gewünschten Speicher braucht.
 *
 * Aufgerundet: Wer 15 kWh will, bekommt eher 15,8 als 12,6 — der
 * Speicher ist die Reserve für die Nacht, und zu klein ist der Fehler,
 * den der Kunde merkt. Über der Stapelgrenze bleibt es beim Höchstwert;
 * dass mehr nicht geht, sagt das Panel dazu.
 */
export function modulzahlFuerKwh(s: SpeicherTyp, kwh: number): number {
  if (!istModular(s)) return 1;
  const gross = s.modulgroesse_kwh ?? s.nutzbar_kwh;
  return modulzahl(s, Math.ceil(kwh / gross - 0.001));
}

export interface SpeicherPosten {
  bezeichnung: string;
  menge: number;
  artikel_id: string | null;
  schluessel: string;
}

/**
 * Der Speicher als Stückliste.
 *
 * Beim Stapel zwei Zeilen: die Module und einmal die Steuereinheit.
 * Sie steht ausdrücklich als eigene Position da und nicht im Preis der
 * Module versteckt — sie hat einen eigenen Artikel, einen eigenen Preis
 * und muss mitbestellt werden.
 */
export function speicherPosten(
  s: SpeicherTyp,
  gewaehlt: number | null | undefined,
): SpeicherPosten[] {
  const name = `${s.hersteller} ${s.bezeichnung}`.trim();
  if (!istModular(s)) {
    return [{ bezeichnung: name, menge: 1, artikel_id: s.artikel_id, schluessel: `speicher:${s.id}` }];
  }

  const n = modulzahl(s, gewaehlt);
  const posten: SpeicherPosten[] = [
    {
      bezeichnung: `${name} Speichermodul (${s.modulgroesse_kwh} kWh)`,
      menge: n,
      artikel_id: s.artikel_id,
      schluessel: `speicher:${s.id}`,
    },
  ];
  posten.push({
    bezeichnung: `${name} BMS mit Sockel`,
    menge: 1,
    /*
     * Ohne hinterlegten Artikel trotzdem als Zeile: Eine fehlende
     * Steuereinheit fällt beim Angebotschreiben nicht auf, eine Zeile
     * mit „Artikel zuordnen" schon.
     */
    artikel_id: s.bms_artikel_id,
    schluessel: `speicher-bms:${s.id}`,
  });
  return posten;
}

/** Die wählbaren Stapelgrössen — für die Auswahlliste im Panel. */
export function stapelStufen(s: SpeicherTyp): number[] {
  const { min, max } = grenzen(s);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/**
 * Die Speichergrösse einer Planung, in kWh — eine Stelle für alle.
 *
 * Reihenfolge mit Absicht: Beim Stapel zählt die Modulzahl, denn was
 * dort steht, ist auch bestellbar. Sonst die von Hand eingetragene
 * Grösse — im Erstgespräch steht „zehn Kilowattstunden" fest, lange
 * bevor jemand ein Gerät aussucht. Zuletzt die Kapazität des gewählten
 * Geräts.
 */
export function speicherKwhVonPlan(
  plan: {
    technik: { speicher: string | null; speicherModule: number | null };
    wirtschaft: { speicherKwh: number | null };
  },
  liste: SpeicherTyp[],
): number {
  const sp = liste.find((x) => x.id === plan.technik.speicher) ?? null;
  if (sp && istModular(sp)) return kapazitaet(sp, plan.technik.speicherModule);
  return plan.wirtschaft.speicherKwh ?? sp?.nutzbar_kwh ?? 0;
}
