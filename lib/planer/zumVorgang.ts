import { planungKennzahlen } from "./kennzahlen";
import { planLesen } from "./plan";
import type { VorgangPdfData } from "@/lib/pdf/vorgang";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Absichtlich ungetypt gegen das Schema: Diese Funktion läuft mit dem
 * Server- wie mit dem Admin-Client, und beide tragen unterschiedliche
 * Generics. Was gelesen wird, steht direkt darunter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/*
 * Die Planungszahlen zu einem Vorgang.
 *
 * Eigenes Modul, weil sie an drei Stellen gebraucht werden: im
 * Angebots-PDF, im Portal-PDF und auf dem Bildschirm des Portals. Läge
 * die Funktion bei der PDF-Erzeugung, zöge die Portalseite den ganzen
 * Renderer mit — für drei Zahlen.
 */

export async function planungFuerVorgang(
  supabase: Client,
  vorgangId: string,
): Promise<NonNullable<VorgangPdfData["planung"]> | null> {
  const { data: projekt } = await supabase
    .from("planer_projekt")
    .select("id, ursprung_lat, ursprung_lon, plan, vorschau_pfad")
    .eq("vorgang_id", vorgangId)
    .maybeSingle();
  if (!projekt) return null;

  const plan = planLesen((projekt as { plan: unknown }).plan);
  if (plan.gruppen.length === 0) return null;

  const [{ data: vorgabe }, { data: speicherZeilen }, { data: positionen }] = await Promise.all([
    supabase
      .from("planer_wirtschaft_vorgabe")
      .select("strompreis, verguetung, steigerung, preisstaffel, speicher_eur_pro_kwh, verlust_prozent")
      .maybeSingle(),
    supabase.from("planer_speicher").select("id, nutzbar_kwh"),
    supabase
      .from("vorgang_position")
      .select("menge, ep_netto, rabatt_prozent")
      .eq("vorgang_id", vorgangId)
      .is("dokument_id", null),
  ]);

  const zeilen = (positionen ?? []) as Array<{
    menge: number | string;
    ep_netto: number | string;
    rabatt_prozent: number | string | null;
  }>;
  const angebotssumme =
    zeilen.length > 0
      ? zeilen.reduce(
          (sum, x) =>
            sum + Number(x.menge) * Number(x.ep_netto) * (1 - Number(x.rabatt_prozent ?? 0) / 100),
          0,
        )
      : null;

  const geraet = ((speicherZeilen ?? []) as Array<{ id: string; nutzbar_kwh: number | string }>)
    .find((sp) => sp.id === plan.technik.speicher);

  const k = planungKennzahlen({
    plan,
    ursprung: {
      lat: Number((projekt as { ursprung_lat: number }).ursprung_lat),
      lon: Number((projekt as { ursprung_lon: number }).ursprung_lon),
    },
    geraetSpeicherKwh: geraet ? Number(geraet.nutzbar_kwh) : 0,
    angebotssumme,
    vorgabe: {
      strompreis: Number(vorgabe?.strompreis ?? 0.32),
      verguetung: Number(vorgabe?.verguetung ?? 0.08),
      steigerung: Number(vorgabe?.steigerung ?? 0.02),
      speicherEurProKwh: Number(vorgabe?.speicher_eur_pro_kwh ?? 0),
      staffel: Array.isArray(vorgabe?.preisstaffel)
        ? (vorgabe.preisstaffel as Array<{ ab_kwp: unknown; eur_pro_kwp: unknown }>).map((st) => ({
            ab_kwp: Number(st.ab_kwp),
            eur_pro_kwp: Number(st.eur_pro_kwp),
          }))
        : [],
      verlustProzent: Number(vorgabe?.verlust_prozent ?? 14),
    },
  });

  /*
   * Das Dachbild als data-URL. Fehlt es, bleibt das Angebot ohne Bild —
   * ein toter Link würde beim Rendern das ganze PDF scheitern lassen.
   */
  let bild: string | null = null;
  const pfad = (projekt as { vorschau_pfad: string | null }).vorschau_pfad;
  if (pfad) {
    const { data: datei } = await supabase.storage.from("planer-fotos").download(pfad);
    if (datei) {
      bild = `data:image/jpeg;base64,${Buffer.from(await datei.arrayBuffer()).toString("base64")}`;
    }
  }

  return {
    kwp: k.kwp,
    jahresertragKwh: k.jahresertragKwh,
    autarkie: k.wirtschaft.autarkie,
    speicherKwh: k.speicherKwh,
    ersparnisJahr1: k.wirtschaft.ersparnisJahr1,
    ersparnis20: k.ersparnis20,
    amortisationJahre: k.wirtschaft.amortisationJahre,
    bild,
  };
}
