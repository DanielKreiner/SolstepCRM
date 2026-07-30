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
  },
  common: {
    logout: "Abmelden",
    retry: "Erneut versuchen",
    cancel: "Abbrechen",
    save: "Speichern",
    undo: "Rückgängig",
  },
} as const;
