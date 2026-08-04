import "server-only";
import { BRAND } from "@/lib/brand";
import { einreihen, kundeZumVorgang, mailClient, portalLink } from "./mail";

/*
 * Die Anlässe, bei denen der Kunde von selbst etwas hört.
 *
 * Bisher schrieb der Betrieb nur beim Angebot, bei einer Rückfrage und
 * bei einer Nachricht. Alles andere erfuhr der Kunde, wenn er anrief —
 * und genau diese Anrufe kosten im Büro den halben Vormittag: „wann
 * kommt ihr denn jetzt", „ist mein Auftrag angekommen".
 *
 * Jede dieser Mails scheitert bewusst leise. Der Auftrag ist ausgelöst,
 * der Termin steht — beides zurückzudrehen, weil beim Kunden keine
 * Mailadresse hinterlegt ist, wäre der schlechtere Tausch.
 */

const WOCHENTAG: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
};

function wann(von: string, bis: string, ganztaegig: boolean): string {
  const a = new Date(von);
  const tag = a.toLocaleDateString("de-AT", WOCHENTAG);
  if (ganztaegig) return `${tag}, ganztägig`;
  const uhr = (d: string) =>
    new Date(d).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  return `${tag} von ${uhr(von)} bis ${uhr(bis)}`;
}

/** Die Auftragsbestätigung — direkt nach der Annahme. */
export async function auftragBestaetigt(
  companyId: string,
  vorgangId: string,
): Promise<string | null> {
  const admin = mailClient();
  const kunde = await kundeZumVorgang(admin, vorgangId);
  if (!kunde.ok || !kunde.empfaenger) return null;

  const link = await portalLink(admin, kunde.kundeId, {
    vorgangId,
    bereich: "fortschritt",
  });

  const r = await einreihen(admin, {
    companyId,
    vorgangId,
    art: "auftrag",
    an: kunde.empfaenger,
    betreff: `Ihr Auftrag ${kunde.nummer} ist angekommen`,
    absaetze: [
      "vielen Dank für Ihren Auftrag. Wir haben alles erfasst und legen los.",
      "Als Nächstes kümmern wir uns um Material, Netzanmeldung und Förderung. Sobald der Montagetermin steht, hören Sie von uns.",
      "Die Auftragsbestätigung und alle weiteren Unterlagen finden Sie in Ihrem Kundenportal.",
    ],
    ...(link ? { knopf: { text: "Zum Projekt", url: link } } : {}),
  });

  return r.ok ? kunde.empfaenger.email : null;
}

/**
 * Der Montagetermin — fixiert oder verschoben.
 *
 * Ein verschobener Termin ist die Nachricht, auf die ein Kunde wartet.
 * Ihn nur in der Tafel zu ändern hiesse, dass er am Montag umsonst
 * daheim bleibt.
 */
export async function terminMitteilen(
  companyId: string,
  vorgangId: string,
  termin: { von: string; bis: string; ganztaegig: boolean },
  verschoben: boolean,
): Promise<string | null> {
  const admin = mailClient();
  const kunde = await kundeZumVorgang(admin, vorgangId);
  if (!kunde.ok || !kunde.empfaenger) return null;

  const link = await portalLink(admin, kunde.kundeId, {
    vorgangId,
    bereich: "fortschritt",
  });
  const zeitpunkt = wann(termin.von, termin.bis, termin.ganztaegig);

  const r = await einreihen(admin, {
    companyId,
    vorgangId,
    art: "termin",
    an: kunde.empfaenger,
    betreff: verschoben
      ? `Neuer Termin für Ihre Montage: ${zeitpunkt}`
      : `Ihr Montagetermin steht: ${zeitpunkt}`,
    absaetze: [
      verschoben
        ? `wir müssen Ihren Montagetermin verschieben. Neu ist ${zeitpunkt}.`
        : `wir haben Ihren Montagetermin fixiert: ${zeitpunkt}.`,
      "Bitte sorgen Sie dafür, dass wir an dem Tag zum Zählerkasten und aufs Dach kommen. Zuhause sein müssen Sie nicht durchgehend — nur zu Beginn und zur Übergabe.",
      "Passt der Termin nicht, sagen Sie uns einfach Bescheid.",
    ],
    ...(link ? { knopf: { text: "Termin ansehen", url: link } } : {}),
  });

  return r.ok ? kunde.empfaenger.email : null;
}

/** Die Erinnerung am Vortag. */
export async function montageErinnerung(
  companyId: string,
  vorgangId: string,
  termin: { von: string; bis: string; ganztaegig: boolean },
): Promise<string | null> {
  const admin = mailClient();
  const kunde = await kundeZumVorgang(admin, vorgangId);
  if (!kunde.ok || !kunde.empfaenger) return null;

  const link = await portalLink(admin, kunde.kundeId, {
    vorgangId,
    bereich: "fortschritt",
  });

  const r = await einreihen(admin, {
    companyId,
    vorgangId,
    art: "termin",
    an: kunde.empfaenger,
    betreff: "Morgen sind wir bei Ihnen",
    absaetze: [
      `morgen ist es so weit: ${wann(termin.von, termin.bis, termin.ganztaegig)}.`,
      "Bitte halten Sie den Zugang zum Zählerkasten frei und stellen Sie, wenn möglich, keine Fahrzeuge vor die Einfahrt — wir kommen mit Material.",
      "Wenn etwas dazwischenkommt, rufen Sie uns bitte heute noch an.",
    ],
    ...(link ? { knopf: { text: "Zum Projekt", url: link } } : {}),
  });

  return r.ok ? kunde.empfaenger.email : null;
}

export { BRAND };
