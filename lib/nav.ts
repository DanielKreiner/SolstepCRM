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
      { label: "Pipelines", href: "/pipelines/projekte", icon: "pipelines", area: "pipelines" },
      { label: "Angebote", href: "/angebote", icon: "angebote", area: "angebote" },
      { label: "CRM", href: "/crm", icon: "crm", area: "crm" },
      { label: "Einsatzplanung", href: "/dispo", icon: "dispo", area: "pipelines" },
      { label: "Lager", href: "/lager", icon: "lager", area: "lager" },
      { label: "Rechnungen", href: "/rechnungen", icon: "rechnungen", area: "rechnungen" },
    ],
  },
  {
    title: "Team",
    items: [
      { label: "Zeiterfassung", href: "/zeiterfassung", icon: "zeit", area: "zeiterfassung" },
      { label: "Stundenkonto", href: "/stundenkonto", icon: "konto", area: "zeiterfassung" },
      { label: "Abwesenheiten", href: "/abwesenheiten", icon: "abwesenheit", area: null },
      { label: "Mitarbeiter", href: "/mitarbeiter", icon: "mitarbeiter", area: "mitarbeiter" },
      { label: "Dokumente", href: "/dokumente", icon: "dokumente", area: null },
      { label: "Chat", href: "/chat", icon: "chat", area: null },
      { label: "Bewerber", href: "/bewerber", icon: "bewerber", area: "mitarbeiter" },
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
