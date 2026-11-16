import { energiefluss, renditeProJahr, speicherVergleich } from "./energiefluss";
import { berechne } from "@/lib/vorgang/preis";
import { rahmenLaden } from "@/lib/vorgang/belegpreis";
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
  /*
   * Soll das Dachbild als data-URL mitkommen?
   *
   * Nur das PDF braucht es eingebettet. Das Kundenportal verwirft es
   * und laedt das Bild ueber einen signierten Link — es wurde bisher
   * trotzdem heruntergeladen und kodiert: 137 KB laden, 183 KB Base64
   * bauen, wegwerfen, bei jedem Seitenaufruf.
   *
   * Schlimmer als die Verschwendung war die Wirkung. Der Download laeuft
   * im Server-Render durch das von Next instrumentierte `fetch`, und
   * dort ist die Antwort an dieser Groesse mit „Maximum call stack size
   * exceeded" gestorben. Nach aussen sah das so aus: Die Portalseite
   * lieferte HTTP 200, brach aber mitten im Strom ab — die
   * Angebotsseite blieb beim Kunden auf halbem Weg stehen. Aufgefallen
   * ist es erst, als die Projekte ueberhaupt ein Vorschaubild bekamen.
   */
  mitBild = true,
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
    { data: gruppenZeilen },
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
      .select(
        "menge, ep_netto, ust_satz, rabatt_prozent, optional, kunden_auswahl, gruppe_id, article_id",
      )
      .eq("vorgang_id", vorgangId)
      .is("dokument_id", null),
    supabase.from("planer_modul").select("id, hersteller, bezeichnung"),
    supabase.from("planer_wechselrichter").select("id, hersteller, bezeichnung"),
    supabase
      .from("vorgang_gruppe")
      .select("id, paket_preis")
      .eq("vorgang_id", vorgangId)
      .is("dokument_id", null),
  ]);

  const zeilen = (positionen ?? []) as Array<{
    menge: number | string;
    ep_netto: number | string;
    ust_satz: number | string;
    rabatt_prozent: number | string | null;
    optional: boolean;
    kunden_auswahl: string | null;
    gruppe_id: string | null;
    article_id: string | null;
  }>;

  /*
   * Die Investition ist das, was auf der Rechnung steht: GESAMT BRUTTO,
   * inklusive Lieferung, ohne die Optionen, die der Kunde nicht gewählt
   * hat.
   *
   * Vorher stand hier die rohe Nettosumme aller Zeilen — Optionen
   * eingerechnet, Steuer nicht. Der Kunde las eine Amortisation zu
   * einem Betrag, den er nirgends wiederfindet: unter dem Angebot steht
   * brutto, und was er nicht angekreuzt hat, zahlt er auch nicht.
   *
   * Gerechnet wird mit derselben Funktion wie die Summenzeile im Portal
   * und im PDF — zwei Preisrechnungen in einem Dokument gäbe es sonst
   * wieder.
   */
  /*
   * Rabatt und Lieferkosten haben kein Spaltenrecht fuer `authenticated`
   * (0025/0041). Ein Select darauf mit dem RLS-Client liefert gar keine
   * Zeile — hier fiel das bisher still auf 0 zurueck, und die
   * Wirtschaftlichkeitsrechnung stand mit einer anderen Investition da
   * als das Angebot daneben. `rahmenLaden` bedient beide Clients.
   */
  const rahmen = await rahmenLaden(supabase, vorgangId);

  const preisAus = (auswahl: typeof zeilen) =>
    berechne(
    auswahl.map((x, i) => ({
      id: String(i),
      gruppeId: x.gruppe_id,
      menge: Number(x.menge),
      epNetto: Number(x.ep_netto),
      ustSatz: Number(x.ust_satz),
      rabattProzent: Number(x.rabatt_prozent ?? 0),
      optional: Boolean(x.optional),
      gewaehlt: x.kunden_auswahl === "gewaehlt" || x.kunden_auswahl === "upgraded",
    })),
    ((gruppenZeilen ?? []) as Array<{ id: string; paket_preis: string | null }>).map((g) => ({
      id: g.id,
      paketPreis: g.paket_preis === null ? null : Number(g.paket_preis),
    })),
    rahmen,
    );

  const preis = preisAus(zeilen);
  const angebotssumme = zeilen.length > 0 ? preis.gesamt : null;

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
    /*
     * Für den Kunden zählt, was auf seinem Angebot steht.
     *
     * Der Preis aus dem Planer ist eine Vorkalkulation für den Betrieb.
     * Stand er hier, las der Kunde eine Amortisation zu 17 000 € neben
     * einem Angebot über 9 713 € — zwei Wahrheiten in einem Umschlag.
     */
    ...(angebotssumme !== null && angebotssumme > 0
      ? { anlagenpreis: angebotssumme }
      : {}),
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
  if (pfad && mitBild) {
    const { data: datei } = await supabase.storage.from("planer-fotos").download(pfad);
    if (datei) {
      bild = `data:image/jpeg;base64,${Buffer.from(await datei.arrayBuffer()).toString("base64")}`;
    }
  }

  /*
   * Was der Speicher im Angebot kostet — für den Vergleich „mit oder
   * ohne". Genommen wird, was wirklich dafür in den Positionen steht:
   * Speichermodule und BMS über ihre Artikel. Steht dort nichts, greift
   * der Richtwert des Betriebs je kWh; sonst stünde im Vergleich eine
   * Anlage ohne Speicher zum selben Preis.
   */
  const speicherArtikel = new Set(
    [geraet?.artikel_id, geraet?.bms_artikel_id].filter((x): x is string => !!x),
  );
  /*
   * Was der Speicher kostet, ist die DIFFERENZ zweier Gesamtpreise: das
   * Angebot mit und ohne die Speicherzeilen.
   *
   * Vorher wurden die Zeilen netto aufsummiert und dieser Betrag von
   * `anlagenpreis` abgezogen — der ist aber brutto inklusive Lieferung.
   * Bei 8.000 Euro Speicher fehlten damit 1.600 Euro Umsatzsteuer, die
   * Spalte „ohne Speicher" stand entsprechend zu hoch, und der Satz
   * „Der Speicher kostet 8.000 Euro" nannte netto, während jede andere
   * Zahl auf der Seite brutto war.
   *
   * Über die Differenz stimmen ausserdem Rabatt, Steuersatz und die
   * Behandlung nicht gewählter Optionen automatisch: eine Option, die
   * der Kunde nicht angekreuzt hat, zählt in beiden Rechnungen nicht und
   * fällt damit aus der Differenz heraus.
   */
  const speicherAusPositionen = Math.max(
    0,
    Math.round(
      (preis.gesamt - preisAus(zeilen.filter((x) => !(x.article_id && speicherArtikel.has(x.article_id)))).gesamt) * 100,
    ) / 100,
  );
  /*
   * Kein Richtwert als Rückfall. Verglichen wird mit dem, was der
   * Speicher im Angebot kostet — steht er dort nicht, gibt es nichts
   * herauszurechnen, und der Vergleich unterbleibt. Ein geschätzter
   * Abzug neben echten Positionen wäre eine Zahl, die der Kunde auf
   * seiner Rechnung nirgends wiederfindet.
   */
  const speicherPreis = speicherAusPositionen;

  const flussEingabe = {
    ertragKwh: k.jahresertragKwh,
    verbrauchKwh: plan.wirtschaft.verbrauchKwh ?? 4500,
    speicherKwh: k.speicherKwh,
    strompreis: plan.wirtschaft.strompreis ?? Number(vorgabe?.strompreis ?? 0.32),
    verguetung: plan.wirtschaft.verguetung ?? Number(vorgabe?.verguetung ?? 0.08),
    anlagenpreis: k.anlagenpreis,
    foerderung: plan.wirtschaft.foerderung ?? 0,
    steigerung: Number(vorgabe?.steigerung ?? 0.02),
  };
  const fluss = energiefluss({ ...flussEingabe, monateKwh: k.monateKwh });
  const vergleich = speicherVergleich(flussEingabe, speicherPreis);

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
    /* ── Energiefluss, Kurve und der Speichervergleich ────────── */
    eigenverbrauchQuote: fluss.eigenverbrauchQuote,
    fluss: {
      direktKwh: fluss.direktKwh,
      ueberSpeicherKwh: fluss.speicherKwh,
      einspeisungKwh: fluss.einspeisungKwh,
      netzbezugKwh: fluss.netzbezugKwh,
      monate: fluss.monate,
    },
    kurve: k.wirtschaft.kurve,
    breakEvenJahr: k.wirtschaft.breakEvenJahr,
    rendite: renditeProJahr(k.ersparnis20, k.wirtschaft.investition),
    speicherPreis,
    vergleich,
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
