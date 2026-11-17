/*
 * Fehlermeldungen des Mailanbieters in Klartext.
 *
 * Eigenes Modul ohne `server-only`: Die Funktion ist reine Rechnung und
 * soll unter vitest prüfbar sein — `zustellen.ts` zieht den
 * Service-Role-Client nach und lässt sich dort nicht laden.
 */

/**
 * Aus der Meldung des Anbieters einen Satz machen, mit dem ein Betrieb
 * etwas anfangen kann.
 *
 * Im Postausgang stand bisher die rohe Antwort, und genau die landete
 * auch in der Mitteilung an die Geschäftsführung — in einem Fall drei
 * Zeilen JSON mit "validation_error" und einem Link auf eine englische
 * Dokumentation. Wer das liest, weiss danach nicht, ob er etwas tun
 * muss.
 *
 * Der volle Text geht nicht verloren: Er steht weiterhin in
 * `mail_outbox.last_error` und damit dort, wo man ihn zur Fehlersuche
 * braucht. In die Mitteilung gehört, was der Betrieb entscheiden kann.
 */
export function inKlartext(fehler: string): string {
  const f = fehler.toLowerCase();

  if (/invalid `?to`?|invalid recipient|validation_error/.test(f)) {
    return "Die Empfängeradresse wurde abgelehnt. Bitte die Mailadresse beim Kunden prüfen.";
  }
  if (/entschlüsselbar|auth|535|authentication/.test(f)) {
    return "Das Postfach hat die Anmeldung abgelehnt. Bitte in den Einstellungen neu verbinden.";
  }
  if (/kein postfach eingehängt/.test(f)) {
    return "Es ist noch kein Postfach eingehängt.";
  }
  if (/timeout|econn|enotfound|nicht erreichbar|getaddrinfo/.test(f)) {
    return "Der Mailanbieter war nicht erreichbar. Der Versand wird automatisch wiederholt.";
  }
  if (/quota|rate limit|429|too many/.test(f)) {
    return "Das Versandkontingent ist erschöpft. Der Versand wird später wiederholt.";
  }
  if (/size|too large|attachment/.test(f)) {
    return "Die Mail war zu gross, meist wegen eines Anhangs.";
  }

  /*
   * Unbekannter Fall: dann lieber eine kurze Fassung als ein Absatz
   * Fremdtext. Die Einstellungen zeigen den vollen Wortlaut.
   */
  const kurz = fehler.replace(/\s+/g, " ").trim();
  return kurz.length > 120 ? `${kurz.slice(0, 117)}…` : kurz;
}
