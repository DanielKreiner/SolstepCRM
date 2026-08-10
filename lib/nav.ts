import type { IconName } from "@/components/ui/Icon";

/*
 * Zwei Apps, eine Codebasis.
 *
 * Nach dem Login entscheidet die Rolle, welche Navigation gilt. Vorher
 * sah jede Rolle dieselben fünfzehn Punkte — ein Monteur scrollte an
 * Rechnungen und Bewerbern vorbei, um seine Zeiten zu finden, und die
 * Geschäftsführung hatte „Stempeln" zwischen Cockpit und Berichten.
 *
 * `area` zeigt auf role_permission. Die Sichtbarkeit wird serverseitig
 * über can() geprüft; die Navigation blendet nur zusätzlich aus.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  /** Bereich in role_permission. null = für jede Rolle der App sichtbar. */
  area: string | null;
};

export type NavGroup = { title: string; items: NavItem[] };

/** Welche App eine Rolle sieht. */
export type AppArt = "betrieb" | "mitarbeiter";

export function appFuerRolle(rolle: string): AppArt {
  return rolle === "monteur" || rolle === "lager" ? "mitarbeiter" : "betrieb";
}

/** Wohin es nach dem Login geht. */
export function startseite(rolle: string): string {
  return appFuerRolle(rolle) === "mitarbeiter" ? "/m/heute" : "/cockpit";
}

/*
 * Die Betriebs-App: neun Punkte, keine Gruppen mehr. Was jemand für
 * sich selbst braucht — eigene Zeiten, eigene Dokumente — steht im
 * Profilmenü und nicht in der Hauptnavigation; sonst mischt sich die
 * Sicht auf den Betrieb mit der Sicht auf sich selbst.
 */
export const NAV: NavGroup[] = [
  {
    title: "Betrieb",
    items: [
      { label: "Cockpit", href: "/cockpit", icon: "cockpit", area: null },
      /*
       * Der Vorgang ist der Einstieg: ein Objekt von der Anfrage bis zur
       * Schlussrechnung. Kundenstammdaten, Anlage, Portalzugang und
       * Historie stehen am Vorgang — ein eigenes CRM wäre eine zweite
       * Liste über dieselben Daten.
       */
      { label: "Vorgänge", href: "/vorgaenge", icon: "pipelines", area: "pipelines" },
      { label: "Planung", href: "/planung", icon: "dispo", area: "pipelines" },
      /*
       * Der Planer steht neben der Planung, nicht darin: hier entsteht die
       * Anlage, dort werden Leute und Tage verteilt.
       *
       * Eigener Bereich 'planer', nicht 'pipelines': dort hat der Monteur
       * Leserecht für seine Aufträge, und damit stünde ihm der Planer
       * offen — ausgeschlossen laut Briefing 10.
       */
      { label: "Planer", href: "/planer", icon: "dispo", area: "planer" },
      { label: "Material", href: "/material", icon: "lager", area: "pipelines" },
      /*
       * Service steht wieder in der Navigation.
       *
       * Das Briefing hatte den Punkt gestrichen, weil Serviceeinsätze in
       * Planung und Vorgängen leben. Das stimmt für den EINSATZ — nicht
       * für das ANLIEGEN, das vorher entsteht: ein Kunde meldet eine
       * Störung über das Portal, und bis jemand daraus einen Termin
       * macht, hat sie sonst keinen Ort. Offene Anliegen lagen damit
       * nirgends, wo man sie findet.
       */
      { label: "Service", href: "/service", icon: "chat", area: "pipelines" },
      { label: "Zeiten", href: "/zeiten", icon: "zeit", area: "zeiterfassung" },
      { label: "Abwesenheiten", href: "/abwesenheiten", icon: "abwesenheit", area: null },
      { label: "Rechnungen", href: "/offene-posten", icon: "rechnungen", area: "rechnungen" },
      { label: "Mitarbeiter", href: "/mitarbeiter", icon: "mitarbeiter", area: "mitarbeiter" },
      { label: "Einstellungen", href: "/einstellungen", icon: "einstellungen", area: "einstellungen" },
    ],
  },
];

/*
 * Die Mitarbeiter-App: vier Punkte, für das Lager fünf. Mehr existiert
 * für diese Rollen nicht — kein Board, keine Plantafel anderer, keine
 * Beträge.
 */
export const NAV_MITARBEITER: NavItem[] = [
  { label: "Heute", href: "/m/heute", icon: "cockpit", area: null },
  { label: "Meine Zeiten", href: "/m/zeiten", icon: "zeit", area: null },
  { label: "Abwesenheiten", href: "/m/abwesenheiten", icon: "abwesenheit", area: null },
  { label: "Dokumente", href: "/m/dokumente", icon: "dokumente", area: null },
  /* Nur für das Lager — der Monteur kommissioniert nicht. */
  { label: "Lager", href: "/material", icon: "lager", area: "lager" },
];

export function navFuerMitarbeiter(rolle: string): NavItem[] {
  return NAV_MITARBEITER.filter((i) => i.area === null || rolle === "lager");
}

export function isActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const ROLE_LABEL: Record<string, string> = {
  gf: "Geschäftsführung",
  buero: "Büro",
  bauleitung: "Bauleitung",
  monteur: "Montage",
  lager: "Lager",
};
