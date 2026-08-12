import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { type PlanungPdfData, PlanungPdf } from "@/lib/pdf/planung";
import { markeAus } from "@/lib/marke";
import { aktiveZellen, anzahlModule, kwp } from "@/lib/planer/module";
import { modulSchluessel, planLesen } from "@/lib/planer/plan";
import { bedarfAusPlan, type GeraeteStand } from "@/lib/planer/uebergabe";
import { pruefe } from "@/lib/planer/elektrik";
import { rechne, richtpreis } from "@/lib/planer/wirtschaft";
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
    .select("id, name, adresse, ursprung_lat, ursprung_lon, plan, vorschau_pfad, updated_at")
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
  const speicherKwh = speicher ? Number(speicher.nutzbar_kwh) : 0;

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
    /*
     * Serverseitig wird der Fallback gerechnet, nicht PVGIS gefragt.
     * Das PDF entsteht auf Knopfdruck und darf nicht an einer fremden
     * API hängen; die Herkunft steht auf der Ertragsseite dabei.
     */
    const e = fallbackErtrag(
      { lat, lon: 0, azimut: flaeche.azimut, neigung: flaeche.neigung, verlustProzent: 14 },
      regionAus(lat),
    );
    return [{ kwp: kwp(g), spezifisch: e.spezifisch, monate: e.monate }];
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
  const strompreis = w.strompreis ?? Number(vorgabe?.strompreis ?? 0.28);
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
  const speicherAufpreis = w.mitSpeicher
    ? speicherKwh * Number(vorgabe?.speicher_eur_pro_kwh ?? 0)
    : 0;
  const anlagenpreis = w.anlagenpreis ?? richtpreis(leistung, staffel, speicherAufpreis);

  const rechnung = rechne({
    ertragKwh: ertrag.jahresertragKwh,
    verbrauchKwh: verbrauch,
    speicherKwh: w.mitSpeicher ? speicherKwh : 0,
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
      artikel_id: (x.artikel_id as string | null) ?? null,
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
