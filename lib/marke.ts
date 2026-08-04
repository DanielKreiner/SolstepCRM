import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND } from "@/lib/brand";

/*
 * Das Erscheinungsbild des Mandanten — für Anzeige und Versand.
 *
 * Für den Kunden ist das Portal die Seite seines Elektrikers und die Mail
 * dessen Post. Für die Mitarbeiter ist die Software das Werkzeug ihres
 * Betriebs. In beiden Fällen gehört dorthin das Logo des Betriebs und
 * nicht unsere Produktmarke.
 *
 * Gelesen wird aus company.pdf_settings — laut CLAUDE.md 6.4 die Ablage
 * für das Firmenlayout. Eine Marke, eine Ablage: was in den
 * Einstellungen steht, gilt für Portal, Backoffice, Mail und PDF.
 */

export type Marke = {
  firma: string;
  logoUrl: string | null;
  akzent: string;
  fusszeile: string | null;
};

export const STANDARD_AKZENT = "#E8952B";

/**
 * Aus dem rohen JSON-Feld eine brauchbare Marke machen.
 *
 * Rein und ohne Datenbank, damit derselbe Code aus einer Server
 * Component, aus einer Route und aus dem Mailversand läuft — der eine
 * hat einen angemeldeten Client, der andere den Admin-Client.
 */
export function markeAus(
  roh: unknown,
  firma: string | null | undefined,
  ort?: (string | null | undefined)[],
): Marke {
  const s = (roh ?? {}) as Record<string, unknown>;
  const akzent = typeof s.akzent === "string" ? s.akzent : "";

  return {
    firma: firma || BRAND.name,
    logoUrl: typeof s.logo_url === "string" && s.logo_url ? s.logo_url : null,
    /*
     * Nur echte Hexfarben durchlassen. Der Wert landet in einem
     * style-Attribut und in Mail-HTML — ein Freitextfeld darf dort nichts
     * anderes hineinschreiben können.
     */
    akzent: /^#[0-9a-fA-F]{6}$/.test(akzent) ? akzent : STANDARD_AKZENT,
    fusszeile:
      typeof s.fusszeile === "string" && s.fusszeile
        ? s.fusszeile
        : [firma, ...(ort ?? [])].filter(Boolean).join(" · ") || null,
  };
}

/** Die Marke des eigenen Mandanten. Funktioniert mit jedem Client. */
export async function markeLaden(
  client: SupabaseClient,
  companyId?: string,
): Promise<Marke> {
  let abfrage = client.from("company").select("name, zip, city, pdf_settings");
  if (companyId) abfrage = abfrage.eq("id", companyId);

  const { data } = await abfrage.limit(1).maybeSingle();
  return markeAus(data?.pdf_settings, data?.name as string | undefined, [
    data?.zip as string | null,
    data?.city as string | null,
  ]);
}
