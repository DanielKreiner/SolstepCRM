/*
 * Mahnstufen.
 *
 * Eigenes Regelmodul (CLAUDE.md Abschnitt 2), weil die Frage "muss diese
 * Rechnung heute gemahnt werden" an drei Stellen gestellt wird: im
 * nächtlichen Lauf, in der Offene-Posten-Liste und beim Mahnen von Hand.
 * Drei Implementierungen wären drei Gelegenheiten, dem Kunden zweimal
 * dasselbe zu schicken.
 *
 * Die Fristen sind bewusst großzügig: ein Handwerksbetrieb verliert mit
 * einer zu scharfen ersten Mahnung mehr Kunden als Geld. Sie sind
 * Produktvorgabe und nicht je Mandant einstellbar — wenn ein Betrieb das
 * braucht, gehört es in die Einstellungen und nicht in eine Kopie dieser
 * Datei.
 */

export type Mahnstufe = {
  stufe: number;
  abTagen: number;
  label: string;
  /** Ton der Nachricht — die erste ist eine Erinnerung, keine Mahnung. */
  ton: "erinnerung" | "mahnung";
};

export const MAHNSTUFEN: readonly Mahnstufe[] = [
  { stufe: 1, abTagen: 7, label: "Zahlungserinnerung", ton: "erinnerung" },
  { stufe: 2, abTagen: 21, label: "1. Mahnung", ton: "mahnung" },
  { stufe: 3, abTagen: 35, label: "2. Mahnung", ton: "mahnung" },
] as const;

/** Kalendertage zwischen zwei ISO-Daten, ohne Zeitanteil. */
export function tageUeberfaellig(faelligAm: string, heute: string): number {
  const a = new Date(`${faelligAm.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${heute.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

export type Beleg = {
  status: string | null;
  faelligAm: string | null;
  mahnstufe: number;
  mahnungAktiv: boolean;
};

/**
 * Welche Stufe ist heute fällig? null heisst: nichts zu tun.
 *
 * Immer nur eine Stufe je Lauf. Ein Betrieb, dessen Cron drei Wochen
 * stillstand, soll seinen Kunden nicht auf einen Schlag die zweite
 * Mahnung schicken — der Weg dorthin gehört durchlaufen.
 */
export function naechsteMahnung(b: Beleg, heute: string): Mahnstufe | null {
  if (!b.mahnungAktiv) return null;
  /* Entwürfe hat der Kunde nie gesehen, Bezahltes und Storniertes ist erledigt. */
  if (b.status !== "versendet") return null;
  if (!b.faelligAm) return null;

  const tage = tageUeberfaellig(b.faelligAm, heute);
  if (tage <= 0) return null;

  return (
    MAHNSTUFEN.find((s) => tage >= s.abTagen && s.stufe > b.mahnstufe) ?? null
  );
}

/** Beschriftung der erreichten Stufe, für Listen und Pillen. */
export function stufenLabel(mahnstufe: number): string | null {
  return MAHNSTUFEN.find((s) => s.stufe === mahnstufe)?.label ?? null;
}
