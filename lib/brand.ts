/*
 * Der Produktname steht noch nicht fest. Deshalb steht er nirgends im Code.
 * Ein Rebranding ist eine Aenderung von drei Umgebungsvariablen, kein Refactoring.
 * CLAUDE.md Abschnitt 0 — kein Literal in Komponenten, Mails, PDF, Manifest, Seitentiteln.
 */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Betrieb",
  legal: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "",
  domain: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supportMail: process.env.NEXT_PUBLIC_SUPPORT_MAIL ?? "",
} as const;

/** Erstes Zeichen des Produktnamens — Sidebar-Marke und Favicon. */
export const BRAND_MARK = BRAND.name.slice(0, 1).toUpperCase();
