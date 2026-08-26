import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { type PlanungPdfData, PlanungPdf } from "@/lib/pdf/planung";
import { markeAus } from "@/lib/marke";
import { aktiveZellen, anzahlModule, ausrichtungen, kwp } from "@/lib/planer/module";
import { modulSchluessel, planLesen } from "@/lib/planer/plan";
import { bedarfAusPlan, type GeraeteStand } from "@/lib/planer/uebergabe";
import { pruefe } from "@/lib/planer/elektrik";
import { anlagenpreisGilt, rechne, richtpreis } from "@/lib/planer/wirtschaft";
import { anlagenErtrag, fallbackErtrag, regionAus } from "@/lib/planer/ertrag";
import { anlagenVerschattung } from "@/lib/planer/verschattung";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Kunden-PDF zur Planung (Briefing 8.1).
 *
 * Alles, was darin steht, wird hier NEU gerechnet — aus dem
 * gespeicherten Plan, nicht aus dem, was der Browser zuletzt angezeigt
 * hat. Ein PDF, das andere Zahlen trägt als die Planung, wäre schlimmer
 * als keines: Es geht zum Kunden und bleibt dort liegen.
 */

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireMe();
  if (me.perms.planer === "none") {
    return NextResponse.json({ fehler: "Kein Zugriff auf den Planer." }, { status: 403 });
  }

  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: projekt } = await supabase
    .from("planer_projekt")
    .select("id, name, adresse, ursprung_lat, ursprung_lon, plan, vorschau_pfad, updated_at, vorgang_id")
    .eq("id", id)
    .maybeSingle();
  if (!projekt) return NextResponse.json({ fehler: "Projekt nicht gefunden." }, { status: 404 });

  const plan = planLesen(projekt.plan);

  const [{ data: firma }, { data: modulZeilen }, { data: wrZeilen }, { data: speicherZeilen }] =
    await Promise.all([
      supabase.from("company").select("name, address, zip, city, email, phone, pdf_settings").maybeSingle(),
      supabase.from("planer_modul").select("*"),
      supabase.from("planer_wechselrichter").select("*"),
      supabase.from("planer_speicher").select("*"),
    ]);

  /* ── Anlage ──────────────────────────────────────────────────── */
  const modulListe = (modulZeilen ?? []) as Array<Record<string, unknown>>;
  const wrs = (wrZeilen ?? []) as Array<Record<string, unknown>>;
  const speicherListe = (speicherZeilen ?? []) as Array<Record<string, unknown>>;

  const modul = modulListe.find((m) => m.id === plan.technik.modul);
  const wr = wrs.find((w) => w.id === plan.technik.wechselrichter);
  const speicher = speicherListe.find((s) => s.id === plan.technik.speicher);

  const name = (g: Record<string, unknown> | undefined) =>
    g ? `${g.hersteller as string} ${g.bezeichnung as string}` : null;

  const leistung = plan.gruppen.reduce((s, g) => s + kwp(g), 0);
  const modulzahl = plan.gruppen.reduce((s, g) => s + anzahlModule(g), 0);
  /*
   * Die von Hand eingetragene Speichergrösse hat Vorrang vor dem
   * Gerät. Vorher las diese Stelle NUR das Gerät — wer im Gespräch
   * „zehn Kilowattstunden" eingetippt hatte, ohne ein Gerät zu
   * wählen, bekam ein Kundenblatt, in dem der Speicher nicht
   * vorkam: dieselbe Autarkie wie ohne, dieselbe Ersparnis.
   */
  const speicherKwh =
    plan.wirtschaft.speicherKwh ?? (speicher ? Number(speicher.nutzbar_kwh) : 0);

  /*
   * Der Prüfstatus wird mitgerechnet, nicht gespeichert: Er hängt an
   * Plan und Geräten, und ein gespeicherter Status wäre nach der
   * nächsten Änderung falsch, ohne dass es jemand merkt.
   */
  let geprueft: boolean | null = null;
  if (modul && wr && plan.strings.length > 0) {
    const alleModule = plan.gruppen.flatMap((g) =>
      aktiveZellen(g).map((z) => modulSchluessel(g.id, z.reihe, z.spalte)),
    );
    const zugeordnet = new Set(plan.strings.flatMap((st) => st.module));

    const elektrik = {
      uoc: Number(modul.uoc),
      umpp: Number(modul.umpp),
      isc: Number(modul.isc),
      impp: Number(modul.impp),
      tkUoc: Number(modul.tk_uoc),
      wp: Number(modul.wp),
      bezeichnung: `${modul.hersteller as string} ${modul.bezeichnung as string}`,
    };
    const maxDcLeistung = wr.max_dc_leistung ? Number(wr.max_dc_leistung) : undefined;

    const ergebnis = pruefe({
      strings: plan.strings.map((st) => ({
        id: st.id,
        name: st.name,
        mppt: st.mppt,
        module: st.module,
        typen: [elektrik],
      })),
      wechselrichter: {
        bezeichnung: `${wr.hersteller as string} ${wr.bezeichnung as string}`,
        hybrid: Boolean(wr.hybrid),
        maxDc: Number(wr.max_dc),
        acNenn: Number(wr.ac_nenn),
        ...(maxDcLeistung !== undefined ? { maxDcLeistung } : {}),
        mppt: (wr.mppt as Array<Record<string, number>>).map((t) => ({
          uMin: Number(t.uMin),
          uMax: Number(t.uMax),
          iMax: Number(t.iMax),
          maxStrings: Number(t.maxStrings),
        })),
      },
      ohneString: alleModule.filter((k) => !zugeordnet.has(k)).length,
    });
    // `geprueft` verlangt fehlerfrei UND alle Module zugeordnet — genau
    // das, was auf dem Blatt für den Elektriker stehen soll.
    geprueft = ergebnis.geprueft;
  }

  /* ── Ertrag ──────────────────────────────────────────────────── */
  const lat = Number(projekt.ursprung_lat);
  const gruppen = plan.gruppen.flatMap((g) => {
    const flaeche = plan.flaechen.find((f) => f.id === g.flaeche);
    if (!flaeche) return [];
    const leistung = kwp(g);
    /*
     * Je Ausrichtung getrennt — dieselbe Regel wie am Bildschirm. Ein
     * Ost/West-Flachdach besteht aus zwei Hälften, und ihr Mittelwert
     * wäre Süden.
     *
     * Serverseitig wird der Fallback gerechnet, nicht PVGIS gefragt:
     * Das PDF entsteht auf Knopfdruck und darf nicht an einer fremden
     * API hängen; die Herkunft steht auf der Ertragsseite dabei.
     */
    return ausrichtungen(g, flaeche).map((a) => {
      const e = fallbackErtrag(
        { lat, lon: 0, azimut: a.azimut, neigung: a.neigung, verlustProzent: 14 },
        regionAus(lat),
      );
      return { kwp: leistung * a.anteil, spezifisch: e.spezifisch, monate: e.monate };
    });
  });
  const roh = anlagenErtrag(gruppen);

  /*
   * Verschattung — mit derselben Funktion wie auf dem Bildschirm.
   *
   * Ohne das stünde im PDF der ungeminderte Ertrag, während der Planer
   * daneben den geminderten zeigt. Beim Kunden läge dann die höhere
   * Zahl auf dem Tisch, und die Anlage könnte sie nie liefern.
   */
  const schatten = anlagenVerschattung(
    plan,
    { lat, lon: Number(projekt.ursprung_lon) },
    plan.gebaeude.wandhoehe,
  );
  const ertrag = {
    ...roh,
    jahresertragKwh: roh.jahresertragKwh * schatten.faktor,
    spezifischMittel: roh.spezifischMittel * schatten.faktor,
    monateKwh: roh.monateKwh.map((m) => m * schatten.faktor),
  };

  /* ── Wirtschaftlichkeit ──────────────────────────────────────── */
  const { data: vorgabe } = await supabase
    .from("planer_wirtschaft_vorgabe")
    .select("strompreis, verguetung, steigerung, preisstaffel, speicher_eur_pro_kwh")
    .maybeSingle();

  const w = plan.wirtschaft;
  const strompreis = w.strompreis ?? Number(vorgabe?.strompreis ?? 0.32);
  const verguetung = w.verguetung ?? Number(vorgabe?.verguetung ?? 0.08);
  const steigerung = Number(vorgabe?.steigerung ?? 0.02);
  const verbrauch = w.verbrauchKwh ?? 4500;

  /*
   * Der Anlagenpreis wird hier GENAUSO hergeleitet wie im Panel: was
   * getippt wurde, sonst der Richtpreis aus der Staffel. Ohne das
   * stünde im PDF eine Investition von 0 € und eine Amortisation von
   * 0,0 Jahren, während der Bildschirm daneben eine echte Zahl zeigt —
   * und das Blatt geht zum Kunden.
   */
  const staffel = Array.isArray(vorgabe?.preisstaffel)
    ? (vorgabe.preisstaffel as Array<{ ab_kwp: unknown; eur_pro_kwp: unknown }>).map((st) => ({
        ab_kwp: Number(st.ab_kwp),
        eur_pro_kwp: Number(st.eur_pro_kwp),
      }))
    : [];
  const speicherAufpreis = speicherKwh * Number(vorgabe?.speicher_eur_pro_kwh ?? 0);

  /*
   * Und derselbe Preis wie am Bildschirm: getippt, sonst die
   * Angebotssumme, sonst der Richtpreis. Ein Kundenblatt mit einer
   * anderen Investition als das Angebot daneben ist der Fehler, den
   * niemand bemerkt, bis der Kunde nachrechnet.
   */
  let angebotssumme: number | null = null;
  if (projekt.vorgang_id) {
    const { data: positionen } = await supabase
      .from("vorgang_position")
      .select("menge, ep_netto, rabatt_prozent")
      .eq("vorgang_id", projekt.vorgang_id as string)
      .is("dokument_id", null);
    const zeilen = (positionen ?? []) as Array<{
      menge: number | string;
      ep_netto: number | string;
      rabatt_prozent: number | string | null;
    }>;
    if (zeilen.length > 0) {
      angebotssumme = zeilen.reduce(
        (sum, x) =>
          sum + Number(x.menge) * Number(x.ep_netto) * (1 - Number(x.rabatt_prozent ?? 0) / 100),
        0,
      );
    }
  }

  const anlagenpreis = anlagenpreisGilt(
    w.anlagenpreis,
    angebotssumme,
    richtpreis(leistung, staffel, speicherAufpreis),
  ).wert;

  const rechnung = rechne({
    ertragKwh: ertrag.jahresertragKwh,
    verbrauchKwh: verbrauch,
    speicherKwh,
    strompreis,
    verguetung,
    anlagenpreis,
    foerderung: w.foerderung ?? 0,
    steigerung,
  });

  /* ── Bild ────────────────────────────────────────────────────── */
  let bild: string | null = null;
  if (projekt.vorschau_pfad) {
    const { data: datei } = await supabase.storage
      .from("planer-fotos")
      .download(projekt.vorschau_pfad as string);
    if (datei) {
      const roh = Buffer.from(await datei.arrayBuffer());
      bild = `data:image/jpeg;base64,${roh.toString("base64")}`;
    }
  }

  /* ── Komponenten ─────────────────────────────────────────────── */
  const stand: GeraeteStand = {
    module: modulListe.map((m) => ({
      id: m.id as string,
      hersteller: m.hersteller as string,
      bezeichnung: m.bezeichnung as string,
      artikel_id: (m.artikel_id as string | null) ?? null,
    })),
    wechselrichter: wrs.map((x) => ({
      id: x.id as string,
      hersteller: x.hersteller as string,
      bezeichnung: x.bezeichnung as string,
      artikel_id: (x.artikel_id as string | null) ?? null,
    })),
    speicher: speicherListe.map((x) => ({
      id: x.id as string,
      hersteller: x.hersteller as string,
      bezeichnung: x.bezeichnung as string,
      nutzbar_kwh: Number(x.nutzbar_kwh),
      modulgroesse_kwh:
        x.modulgroesse_kwh === null || x.modulgroesse_kwh === undefined
          ? null
          : Number(x.modulgroesse_kwh),
      min_module: (x.min_module as number | null) ?? null,
      max_module: (x.max_module as number | null) ?? null,
      artikel_id: (x.artikel_id as string | null) ?? null,
      bms_artikel_id: (x.bms_artikel_id as string | null) ?? null,
    })),
  };

  const marke = markeAus(firma?.pdf_settings, firma?.name as string | undefined);

  const daten: PlanungPdfData = {
    firma: {
      name: (firma?.name as string) ?? marke.firma,
      adresse: [firma?.address, [firma?.zip, firma?.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ") || null,
      kontakt: [firma?.phone, firma?.email].filter(Boolean).join(" · ") || null,
    },
    marke: { logoUrl: marke.logoUrl, akzent: marke.akzent },
    projekt: {
      name: projekt.name as string,
      adresse: (projekt.adresse as string | null) ?? null,
      datum: new Date(projekt.updated_at as string).toLocaleDateString("de-AT"),
    },
    bild,
    anlage: {
      kwp: leistung,
      module: modulzahl,
      modulTyp: name(modul),
      wechselrichter: name(wr),
      speicher: name(speicher),
      speicherKwh,
      flaechen: plan.flaechen.map((f) => ({
        name: f.name,
        neigung: f.neigung,
        azimut: f.azimut,
        module: plan.gruppen.filter((g) => g.flaeche === f.id).reduce((s, g) => s + anzahlModule(g), 0),
      })),
      geprueft,
    },
    ertrag: {
      jahresertragKwh: ertrag.jahresertragKwh,
      spezifisch: ertrag.spezifischMittel,
      monate: ertrag.monateKwh,
      quelle: "geschaetzt",
      /*
       * Der Abschlag wird ausgewiesen, nicht stillschweigend
       * eingerechnet: Wer das Blatt liest, soll sehen, dass zwei Bäume
       * im Süden stehen und was sie kosten.
       */
      ...(schatten.faktor < 1
        ? { verschattungProzent: Math.round((1 - schatten.faktor) * 1000) / 10 }
        : {}),
    },
    wirtschaft: {
      autarkie: rechnung.autarkie,
      eigenverbrauchKwh: rechnung.eigenverbrauchKwh,
      einspeisungKwh: rechnung.einspeisungKwh,
      verbrauchKwh: verbrauch,
      ersparnisJahr1: rechnung.ersparnisJahr1,
      amortisationJahre: rechnung.amortisationJahre,
      investition: rechnung.investition,
      strompreis,
      verguetung,
      steigerung,
      mitSpeicher: w.mitSpeicher,
    },
    komponenten: bedarfAusPlan(plan, stand).map((p) => ({
      bezeichnung: p.bezeichnung,
      menge: p.menge,
      einheit: p.einheit,
    })),
  };

  const puffer = await renderToBuffer(<PlanungPdf data={daten} />);
  const dateiname = `Planung-${(projekt.name as string).replace(/[^\w-]+/g, "-")}.pdf`;

  return new NextResponse(new Uint8Array(puffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${dateiname}"`,
      // Nie cachen: die Planung ändert sich, das PDF muss folgen.
      "Cache-Control": "no-store",
    },
  });
}
