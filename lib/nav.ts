import type { IconName } from "@/components/ui/Icon";

/*
 * Navigation. Gruppen und Reihenfolge aus dem Mockup, Pfade aus CLAUDE.md
 * Abschnitt 2. `area` zeigt auf role_permission — die Sichtbarkeit wird
 * serverseitig über can() geprüft, die Navigation blendet nur zusätzlich aus.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  /** Bereich in role_permission. null = für jede Rolle sichtbar. */
  area: string | null;
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    title: "Betrieb",
    items: [
      { label: "Cockpit", href: "/cockpit", icon: "cockpit", area: null },
      /*
       * Der Vorgang ist ab jetzt der Einstieg: ein Objekt von der Anfrage
       * bis zur Schlussrechnung. Die alten Pipelines stehen daneben,
       * solange der Umbau läuft.
       */
      { label: "Vorgänge", href: "/vorgaenge", icon: "pipelines", area: "pipelines" },
      { label: "Planung", href: "/planung", icon: "dispo", area: "pipelines" },
      { label: "Material", href: "/material", icon: "lager", area: "pipelines" },
      { label: "Offene Posten", href: "/offene-posten", icon: "rechnungen", area: "rechnungen" },
      { label: "CRM", href: "/crm", icon: "crm", area: "crm" },
      /*
       * Service steht in der Navigation, obwohl es die dritte Pipeline ist.
       * Anliegen aus dem Kundenportal landeten sonst in einer Ansicht, die
       * niemand aufruft — der Kunde schreibt und hört nie etwas.
       */
      { label: "Service", href: "/service", icon: "chat", area: "pipelines" },
      { label: "Lager", href: "/lager", icon: "lager", area: "lager" },
    ],
  },
  {
    /*
     * "Mein Arbeitstag" steht vor dem Teambereich, weil er jeden angeht —
     * auch die Rollen ohne Leserecht auf fremde Zeiten. Vorher gab es von
     * hier aus keinen Weg zur Stempeluhr: /m war nur direkt aufrufbar, und
     * wer im Büro sitzt, findet eine App-URL nicht von selbst.
     */
    title: "Mein Arbeitstag",
    items: [
      /*
       * Für die Montage der Einstieg: wohin, wann, was ist zu tun. Kein
       * Board, keine Beträge — die liefert die Datenbank dieser Rolle
       * gar nicht.
       */
      { label: "Mein Einsatz", href: "/mein-einsatz", icon: "einsatz", area: null },
      { label: "Stempeln", href: "/m/stempeln", icon: "zeit", area: null },
      { label: "Meine Zeiten", href: "/meine-zeiten", icon: "konto", area: null },
      { label: "Meine Dokumente", href: "/meine-dokumente", icon: "dokumente", area: null },
      { label: "Abwesenheiten", href: "/abwesenheiten", icon: "abwesenheit", area: null },
    ],
  },
  {
    title: "Team",
    items: [
      { label: "Zeiterfassung", href: "/zeiterfassung", icon: "zeit", area: "zeiterfassung" },
      { label: "Stundenkonto", href: "/stundenkonto", icon: "konto", area: "zeiterfassung" },
      { label: "Mitarbeiter", href: "/mitarbeiter", icon: "mitarbeiter", area: "mitarbeiter" },
      { label: "Dokumente", href: "/dokumente", icon: "dokumente", area: null },
      { label: "Chat", href: "/chat", icon: "chat", area: null },
      { label: "Bewerber", href: "/bewerber", icon: "bewerber", area: "mitarbeiter" },
    ],
  },
  {
    /*
     * Der Altbestand.
     *
     * Diese Screens arbeiten auf quote, job und invoice — dem Modell vor
     * dem Vorgang. Sie stehen hier unten und nicht mehr im Arbeitsbereich,
     * damit es genau einen offensichtlichen Weg gibt.
     *
     * Entfernt sind sie noch nicht, weil an ihnen Dinge hängen, die der
     * Vorgang noch nicht kann: das Kundenportal zeigt und nimmt Angebote
     * über quote an, die Crons für Nachfassen, Mahnung und
     * Buchhaltungsexport lesen quote und invoice, und die Berichte
     * rechnen über job. Wer sie jetzt löscht, nimmt dem Betrieb diese
     * Funktionen weg, ohne Ersatz.
     */
    title: "Altbestand",
    items: [
      { label: "Pipelines", href: "/pipelines/projekte", icon: "pipelines", area: "pipelines" },
      { label: "Angebote", href: "/angebote", icon: "angebote", area: "angebote" },
      { label: "Aufträge", href: "/auftraege", icon: "pipelines", area: "pipelines" },
      { label: "Einsatzplanung", href: "/dispo", icon: "dispo", area: "pipelines" },
      { label: "Rechnungen", href: "/rechnungen", icon: "rechnungen", area: "rechnungen" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Berichte", href: "/berichte", icon: "berichte", area: "berichte" },
      { label: "Einstellungen", href: "/einstellungen", icon: "einstellungen", area: "einstellungen" },
    ],
  },
];

/** Aufträge hängen an der Projekte-Pipeline, haben aber eigene Routen. */
export function isActive(href: string, pathname: string): boolean {
  if (href === "/pipelines/projekte") {
    return pathname.startsWith("/pipelines") || pathname.startsWith("/auftraege");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const ROLE_LABEL: Record<string, string> = {
  gf: "Geschäftsführung",
  buero: "Büro",
  bauleitung: "Bauleitung",
  monteur: "Montage",
  lager: "Lager",
};
