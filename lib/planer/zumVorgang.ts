import { planungKennzahlen } from "./kennzahlen";
import { geraetName } from "./geraetname";
import { anzahlModule } from "./module";
import { modulzahl, speicherKwhVonPlan } from "./speicher";
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

  const [
    { data: vorgabe },
    { data: speicherZeilen },
    { data: positionen },
    { data: modulZeilen },
    { data: wrZeilen },
  ] = await Promise.all([
    supabase
      .from("planer_wirtschaft_vorgabe")
      .select("strompreis, verguetung, steigerung, preisstaffel, speicher_eur_pro_kwh, verlust_prozent")
      .maybeSingle(),
    supabase
      .from("planer_speicher")
      .select(
        "id, hersteller, bezeichnung, nutzbar_kwh, modulgroesse_kwh, min_module, max_module, artikel_id, bms_artikel_id",
      ),
    supabase
      .from("vorgang_position")
      .select("menge, ep_netto, rabatt_prozent")
      .eq("vorgang_id", vorgangId)
      .is("dokument_id", null),
    supabase.from("planer_modul").select("id, hersteller, bezeichnung"),
    supabase.from("planer_wechselrichter").select("id, hersteller, bezeichnung"),
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

  const speicherTypen = ((speicherZeilen ?? []) as Array<Record<string, unknown>>).map((sp) => ({
    id: sp.id as string,
    hersteller: sp.hersteller as string,
    bezeichnung: sp.bezeichnung as string,
    nutzbar_kwh: Number(sp.nutzbar_kwh),
    modulgroesse_kwh: sp.modulgroesse_kwh == null ? null : Number(sp.modulgroesse_kwh),
    min_module: (sp.min_module as number | null) ?? null,
    max_module: (sp.max_module as number | null) ?? null,
    artikel_id: (sp.artikel_id as string | null) ?? null,
    bms_artikel_id: (sp.bms_artikel_id as string | null) ?? null,
  }));
  const geraet = speicherTypen.find((sp) => sp.id === plan.technik.speicher);
  const speicherKwh = plan.wirtschaft.mitSpeicher
    ? speicherKwhVonPlan(plan, speicherTypen)
    : 0;

  const k = planungKennzahlen({
    plan,
    ursprung: {
      lat: Number((projekt as { ursprung_lat: number }).ursprung_lat),
      lon: Number((projekt as { ursprung_lon: number }).ursprung_lon),
    },
    geraetSpeicherKwh: geraet ? Number(geraet.nutzbar_kwh) : 0,
    speicherKwh,
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

  /*
   * Die Geräte beim Namen nennen. „Wechselrichter: vorhanden" hilft
   * niemandem — im Angebot steht, was verbaut wird.
   */
  const name = (
    liste: Array<{ id: string; hersteller: string; bezeichnung: string }> | null,
    id: string | null,
  ): string | null => {
    const treffer = (liste ?? []).find((x) => x.id === id);
    return treffer ? geraetName(treffer) : null;
  };

  const modulAnzahl = plan.gruppen.reduce((sum, g) => sum + anzahlModule(g), 0);

  return {
    kwp: k.kwp,
    jahresertragKwh: k.jahresertragKwh,
    autarkie: k.wirtschaft.autarkie,
    speicherKwh: k.speicherKwh,
    ersparnisJahr1: k.wirtschaft.ersparnisJahr1,
    ersparnis20: k.ersparnis20,
    amortisationJahre: k.wirtschaft.amortisationJahre,
    bild,
    /* Der Speicherort des Bildes — das Portal signiert ihn selbst. */
    bildPfad: pfad ?? null,

    /* ── Was bisher nur im Planungs-PDF stand ─────────────────── */
    spezifisch: k.spezifischMittel,
    monateKwh: k.monateKwh,
    verschattungProzent: k.verschattung,
    verbrauchKwh: plan.wirtschaft.verbrauchKwh ?? 4500,
    eigenverbrauchKwh: k.wirtschaft.eigenverbrauchKwh,
    einspeisungKwh: k.wirtschaft.einspeisungKwh,
    strompreis: plan.wirtschaft.strompreis ?? Number(vorgabe?.strompreis ?? 0.32),
    verguetung: plan.wirtschaft.verguetung ?? Number(vorgabe?.verguetung ?? 0.08),
    steigerung: Number(vorgabe?.steigerung ?? 0.02),
    investition: k.wirtschaft.investition,
    modulAnzahl,
    modulTyp: name(modulZeilen as never, plan.technik.modul),
    wechselrichter: name(wrZeilen as never, plan.technik.wechselrichter),
    speicher: geraet ? geraetName(geraet) : null,
    speicherModule: geraet && geraet.modulgroesse_kwh ? modulzahl(geraet, plan.technik.speicherModule) : null,
    flaechen: plan.flaechen.map((f) => ({
      name: f.name,
      neigung: f.neigung,
      azimut: f.azimut,
      module: plan.gruppen
        .filter((g) => g.flaeche === f.id)
        .reduce((sum, g) => sum + anzahlModule(g), 0),
    })),
  };
}
