/*
 * Alle sichtbaren Texte an einer Stelle. Kein i18n-Framework — das Produkt ist
 * deutschsprachig (AT/DE/CH). Kein Gendern, keine Fuellphrasen.
 */
export const T = {
  login: {
    title: "Anmelden",
    subtitle: "Zugang zum Backoffice",
    email: "E-Mail",
    password: "Passwort",
    submit: "Anmelden",
    submitting: "Wird geprüft …",
    forgot: "Passwort vergessen",
    failed: "E-Mail oder Passwort stimmt nicht.",
    noAccount:
      "Zugänge vergibt die Geschäftsführung des Betriebs, keine Selbstregistrierung.",
    rateLimited: "Zu viele Versuche. Bitte in einer Minute erneut probieren.",
    unexpected: "Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
    linkHinweis:
      "Der Link war nicht mehr gültig. Fordern Sie unten einen neuen an.",
  },
  zugang: {
    title: "Passwort vergeben",
    subtitle: "Danach sind Sie angemeldet.",
    passwort: "Neues Passwort",
    wiederholung: "Noch einmal",
    submit: "Passwort speichern",
    submitting: "Wird gespeichert …",
    zuKurz: "Mindestens zehn Zeichen.",
    ungleich: "Die beiden Eingaben stimmen nicht überein.",
    fehlgeschlagen: "Das Passwort konnte nicht gesetzt werden.",
    vergessenTitle: "Passwort vergessen",
    vergessenSubtitle:
      "Wir schicken einen Link an die Adresse Ihres Zugangs.",
    vergessenSubmit: "Link anfordern",
    vergessenLaeuft: "Wird gesendet …",
    /*
     * Dieselbe Antwort, ob es die Adresse gibt oder nicht — sonst
     * verrät das Formular, wer im Betrieb einen Zugang hat.
     */
    vergessenFertig:
      "Wenn zu dieser Adresse ein Zugang besteht, ist der Link unterwegs. Prüfen Sie auch den Spam-Ordner.",
    zurueck: "Zurück zur Anmeldung",
  },
  common: {
    logout: "Abmelden",
    retry: "Erneut versuchen",
    cancel: "Abbrechen",
    save: "Speichern",
    undo: "Rückgängig",
  },
} as const;
