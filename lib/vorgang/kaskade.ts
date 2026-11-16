import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anzahlung, summen } from "@/lib/vorgang/modell";
import { belegPreis, nettoAus } from "@/lib/vorgang/belegpreis";
import { bedarfVorbefuellen } from "@/lib/material/bedarf";

/**
 * Die Annahme-Kaskade — an einer Stelle.
 *
 * Ein Angebot kann auf zwei Wegen angenommen werden: im Backoffice, wenn
 * der Kunde anruft, und im Kundenportal über den Link. Beide müssen
 * dasselbe auslösen — Auftragsbestätigung, Anzahlungsrechnung,
 * Materialbedarf, Gates und Soll-Werte. Zwei Fassungen wären zwei
 * Wahrheiten darüber, was ein Auftrag ist; genau dieser Fehler ist beim
 * alten Modell schon einmal passiert (siehe lib/quote-accept.ts).
 *
 * Der Client kommt von aussen: im Backoffice der RLS-Client des Nutzers,
 * im Portal der Service-Role-Client — dort ist die Zugehörigkeit des
 * Vorgangs zum Kunden vorher geprüft.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type KaskadeEingabe = {
  vorgangId: string;
  companyId: string;
  /** Wer angenommen hat. Im Portal null — dort war es der Kunde. */
  userId: string | null;
  anzahlungProzent: number;
  wunschZeitraum: string;
  geruest: "ja" | "nein";
  sub: "ja" | "nein";
  /** Steht im Verlaufseintrag. */
  quelle: "backoffice" | "portal";
  /** Name des Zusagenden, wenn der Kunde selbst angenommen hat. */
  angenommenVon?: string | null;
};

export type KaskadeErgebnis =
  | { ok: true; neu: boolean; meldung: string }
  | { ok: false; grund: string };

export async function kaskadeAusloesen(
  supabase: Client,
  d: KaskadeEingabe,
): Promise<KaskadeErgebnis> {
  const companyId = d.companyId;
  const userId = d.userId;

  const { data: v } = await supabase
    .from("vorgang")
    .select("id, number, phase, ust_satz, rabatt_prozent, lieferung_netto")
    .eq("id", d.vorgangId)
    .maybeSingle();

  if (!v) return { ok: false, grund: "Vorgang nicht gefunden." };
  if (v.phase !== "angebot") {
    return {
      ok: false,
      grund: `Nur ein versendetes Angebot lässt sich annehmen. Der Vorgang steht in „${v.phase as string}".`,
    };
  }

  /* Zweimal annehmen darf keinen zweiten Auftrag erzeugen. */
  const { data: schonDa } = await supabase
    .from("vorgang_dokument")
    .select("id")
    .eq("vorgang_id", d.vorgangId)
    .eq("typ", "ab")
    .maybeSingle();

  if (schonDa) {
    return { ok: true, neu: false, meldung: "Der Auftrag wurde bereits ausgelöst." };
  }

  /* ------------------------------------------------- 1. POSITIONEN */
  const { data: posRoh } = await supabase
    .from("vorgang_position")
    .select(
      "id, sort, gruppe_id, article_id, bezeichnung, menge, einheit, ep_netto, ust_satz, "
      + "kalk_stunden, kalk_ek, ist_material, bild_url, beschreibung, rabatt_prozent, "
      + "optional, kunden_auswahl, upgrade_article_id, upgrade_kategorie, "
      + "upgrade_aufpreis, upgrade_text",
    )
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null)
    .order("sort");

  const positionen = (posRoh ?? []) as unknown as PosRoh[];
  if (positionen.length === 0) {
    return {
      ok: false,
      grund: "Ohne Positionen gibt es keinen Auftragswert. Bitte zuerst das Angebot füllen.",
    };
  }

  /*
   * Zwei Rechnungen mit verschiedenen Aufgaben:
   *
   * `summen()` liefert die INTERNEN Kennzahlen — Sollstunden und
   * Materialeinkauf. Die hängen an den Positionen selbst und haben mit
   * dem Kundenbetrag nichts zu tun.
   *
   * `belegPreis()` liefert, was der Kunde zahlt, und zwar mit derselben
   * Rechnung wie Angebotseditor, Angebots-PDF und Kundenportal. Vorher
   * stand hier `summen()` auch für den Betrag, und das addierte bloss
   * `menge × ep_netto`: ohne Positionsrabatt, ohne Paketpreis, ohne
   * Lieferkosten und ohne die nicht gewählten Optionen auszunehmen. Die
   * Auftragsbestätigung konnte den Angebotsbetrag deshalb gar nicht
   * treffen.
   */
  const s = summen(
    positionen.map((p) => ({
      menge: Number(p.menge),
      epNetto: Number(p.ep_netto),
      ustSatz: Number(p.ust_satz),
      kalkStunden: p.kalk_stunden === null ? null : Number(p.kalk_stunden),
      kalkEk: p.kalk_ek === null ? null : Number(p.kalk_ek),
      istMaterial: p.ist_material,
    })),
  );

  const { data: gruppenRoh } = await supabase
    .from("vorgang_gruppe")
    .select("id, name, beschreibung, sort, paket_preis, einzelpreise_verstecken")
    .eq("vorgang_id", d.vorgangId)
    .is("dokument_id", null);

  const ustSatz = v.ust_satz === null ? 20 : Number(v.ust_satz);
  const preis = belegPreis(positionen, (gruppenRoh ?? []) as { id: string }[], {
    ustSatz,
    rabattProzent: v.rabatt_prozent === null ? 0 : Number(v.rabatt_prozent),
    lieferungNetto: v.lieferung_netto === null ? 0 : Number(v.lieferung_netto),
  });

  /* Netto, das der Kunde schuldet: Positionen nach Rabatt plus Lieferung. */
  const auftragNetto = Math.round((preis.netto + preis.lieferungNetto) * 100) / 100;

  const { anzahlungBrutto } = anzahlung(preis.gesamt, d.anzahlungProzent);

  /* --------------------------------------- 2. AUFTRAGSBESTÄTIGUNG */
  /*
   * Die AB trägt die Vorgangsnummer, keine eigene. Das ist der ganze
   * Sinn des Umbaus: V-2026-0042 ist Anfrage, Angebot, Auftrag und
   * Rechnungsbezug in einem.
   */
  const { data: ab, error: abFehler } = await supabase
    .from("vorgang_dokument")
    .insert({
      company_id: companyId,
      vorgang_id: d.vorgangId,
      typ: "ab",
      kunde_sichtbar: true,
      nummer: v.number as string,
      dateiname: `Auftragsbestätigung ${v.number as string}.pdf`,
      betrag_netto: auftragNetto,
      betrag_brutto: preis.gesamt,
      status: "entwurf",
      created_by: userId,
    })
    .select("id")
    .single();

  if (abFehler || !ab) {
    return { ok: false, grund: `Auftragsbestätigung fehlgeschlagen: ${abFehler?.message}` };
  }

  /*
   * Erst die Gruppen, dann die Positionen.
   *
   * Die AB fror bisher nur die Positionen ein — die Gruppen blieben
   * zurück. Damit fand jedes spätere Dokument (AB, Anzahlungs- und
   * Schlussrechnung, „Ihr Auftrag" im Portal) keine Gruppe zu seinen
   * Positionen und zeigte jede Zeile einzeln mit ihrem Preis. Genau
   * das, was der Betrieb im Angebot ausdrücklich versteckt hatte: Wer
   * ein Paket verkauft, will nicht zwanzig Einzelpreise daneben stehen
   * haben, über die der Kunde dann verhandelt.
   */
  const gruppenAbbildung = new Map<string, string>();
  for (const g of (gruppenRoh ?? []) as unknown as Array<{
    id: string;
    name: string;
    beschreibung: string | null;
    sort: number;
    paket_preis: string | null;
    einzelpreise_verstecken: boolean;
  }>) {
    const { data: neu } = await supabase
      .from("vorgang_gruppe")
      .insert({
        company_id: companyId,
        vorgang_id: d.vorgangId,
        dokument_id: ab.id,
        name: g.name,
        beschreibung: g.beschreibung,
        sort: g.sort,
        paket_preis: g.paket_preis,
        einzelpreise_verstecken: g.einzelpreise_verstecken,
      })
      .select("id")
      .single();
    if (neu) gruppenAbbildung.set(g.id, neu.id as string);
  }

  /*
   * Die Positionen werden auf die AB kopiert und damit eingefroren. Der
   * Entwurf bleibt daneben stehen — er ist ab jetzt gesperrt, aber er
   * ist auch die Grundlage der Schlussrechnung.
   */
  await supabase.from("vorgang_position").insert(
    positionen.map((p) => ({
      company_id: companyId,
      vorgang_id: d.vorgangId,
      dokument_id: ab.id,
      sort: p.sort,
      gruppe_id: p.gruppe_id ? (gruppenAbbildung.get(p.gruppe_id) ?? null) : null,
      article_id: p.article_id,
      bezeichnung: p.bezeichnung,
      menge: p.menge,
      einheit: p.einheit,
      ep_netto: p.ep_netto,
      ust_satz: p.ust_satz,
      rabatt_prozent: p.rabatt_prozent,
      optional: p.optional,
      kalk_stunden: p.kalk_stunden,
      kalk_ek: p.kalk_ek,
      ist_material: p.ist_material,
      bild_url: p.bild_url,
      beschreibung: p.beschreibung,
      /*
       * Die Wahl des Kunden und das Upgrade gehoeren mit eingefroren.
       * `kunden_auswahl` ist laut Spaltenkommentar in 0041 der Beleg
       * dafuer, was er tatsaechlich bestellt hat; fiel es hier auf
       * 'standard' zurueck, war im Streitfall nicht mehr nachweisbar,
       * welche Option angekreuzt und welches Produkt gewaehlt war.
       */
      kunden_auswahl: p.kunden_auswahl,
      upgrade_article_id: p.upgrade_article_id,
      upgrade_kategorie: p.upgrade_kategorie,
      upgrade_aufpreis: p.upgrade_aufpreis,
      upgrade_text: p.upgrade_text,
    })),
  );

  /* ------------------------------------- 3. ANZAHLUNGSRECHNUNG */
  let reNummer: string | null = null;
  if (anzahlungBrutto > 0) {
    const { data: nr } = await supabase.rpc("next_number", {
      p_company: companyId,
      p_kind: "invoice",
    });
    reNummer = typeof nr === "string" ? nr : null;

    if (reNummer) {
      const faellig = new Date();
      faellig.setDate(faellig.getDate() + 14);

      await supabase.from("vorgang_dokument").insert({
        company_id: companyId,
        vorgang_id: d.vorgangId,
        typ: "anzahlungsrechnung",
        kunde_sichtbar: true,
        nummer: reNummer,
        dateiname: `Anzahlungsrechnung ${reNummer}.pdf`,
        betrag_netto: nettoAus(anzahlungBrutto, ustSatz),
        betrag_brutto: anzahlungBrutto,
        /* Entwurf, nicht versendet: der Versand ist eine eigene Entscheidung. */
        status: "entwurf",
        faellig_am: faellig.toISOString().slice(0, 10),
        created_by: userId,
      });
    }
  }

  /* ------------------------------------ 4. MATERIALBEDARFSLISTE */
  const material = positionen.filter((p) => p.ist_material);
  if (material.length > 0) {
    await supabase.from("vorgang_dokument").insert({
      company_id: companyId,
      vorgang_id: d.vorgangId,
      typ: "materialliste",
      /* Einkaufspreise — bleibt im Betrieb. */
      kunde_sichtbar: false,
      dateiname: `Materialbedarf ${v.number as string}.pdf`,
      betrag_netto: s.materialEk,
      status: "entwurf",
      created_by: userId,
    });
  }

  /*
   * Die Bedarfsliste — das, was tatsächlich gebraucht wird. Die
   * Materialliste oben ist ein Beleg, das hier ist die Arbeitsgrundlage:
   * Pakete aufgelöst, Pauschalen aussen vor, ab jetzt frei bearbeitbar.
   */
  const bedarf = await bedarfVorbefuellen(supabase, {
    companyId,
    vorgangId: d.vorgangId,
  });

  /* --------------------------------------------------- 5. GATES */
  const { data: vorlagen } = await supabase
    .from("gate_template")
    .select("key, label, meta, blocking, sort")
    .eq("company_id", companyId)
    .order("sort");

  const gates = ((vorlagen ?? []) as unknown as {
    key: string;
    label: string;
    meta: string | null;
    blocking: boolean;
    sort: number;
  }[]).map((t) => ({
    company_id: companyId,
    vorgang_id: d.vorgangId,
    key: t.key,
    label: t.label,
    meta: t.meta,
    blocking: t.blocking,
    sort: t.sort,
    /*
     * Aus den Antworten im Dialog vorbelegt. Wer „kein Gerüst nötig"
     * angibt, soll es nicht gleich danach abhaken müssen.
     */
    status:
      t.key === "geruest"
        ? d.geruest === "ja"
          ? "offen"
          : "nicht_noetig"
        : t.key === "team"
          ? d.sub === "ja"
            ? "laeuft"
            : "erledigt"
          : "offen",
  }));

  if (gates.length > 0) {
    await supabase.from("vorgang_gate").insert(gates);
  }

  /* ---------------------------------- 6. VORGANG FORTSCHREIBEN */
  const { error: vFehler } = await supabase
    .from("vorgang")
    .update({
      phase: "beauftragt",
      phase_seit: new Date().toISOString(),
      auftragswert_netto: auftragNetto,
      anzahlung_prozent: d.anzahlungProzent,
      /*
       * Soll-Werte aus der angenommenen Fassung. Später sind sie nicht
       * mehr zu ermitteln — der Entwurf wandert weiter, die Artikelpreise
       * ändern sich.
       */
      soll_stunden: s.stunden,
      soll_materialkosten: s.materialEk,
      updated_at: new Date().toISOString(),
    })
    .eq("id", d.vorgangId);

  if (vFehler) {
    return { ok: false, grund: `Auftrag konnte nicht ausgelöst werden: ${vFehler.message}` };
  }

  /* --------------------------------------------------- 7. STROM */
  const teile = [
    `Auftragswert ${fmt(auftragNetto)} netto.`,
    `Auftragsbestätigung ${v.number as string} erzeugt.`,
    reNummer
      ? `Anzahlungsrechnung ${reNummer} über ${fmt(anzahlungBrutto)} brutto (${d.anzahlungProzent} %) als Entwurf.`
      : "Keine Anzahlung vereinbart.",
    material.length > 0
      ? `Materialbedarf über ${material.length} Positionen, ${fmt(s.materialEk)} Einkauf.`
      : "Kein Material im Auftrag.",
    bedarf.zeilen > 0 ? `Bedarfsliste mit ${bedarf.zeilen} Zeilen vorbefüllt.` : "",
    `${gates.length} Gates angelegt.`,
    `Soll: ${s.stunden.toLocaleString("de-AT")} h und ${fmt(s.materialEk)} Material.`,
    d.wunschZeitraum ? `Wunschzeitraum ${d.wunschZeitraum}.` : "",
  ].filter(Boolean);

  await supabase.from("vorgang_event").insert({
    company_id: companyId,
    vorgang_id: d.vorgangId,
    typ: "phase_wechsel",
    titel:
      d.quelle === "portal"
        ? `Angebot im Kundenportal angenommen${d.angenommenVon ? ` von ${d.angenommenVon}` : ""}`
        : "Angebot angenommen → Auftrag ausgelöst",
    /* Der Kunde sieht seinen eigenen Fortschritt. */
    kunde_sichtbar: true,
    body: teile.join(" "),
    payload: {
      anzahlung_prozent: d.anzahlungProzent,
      wunsch_zeitraum: d.wunschZeitraum || null,
      geruest: d.geruest,
      sub: d.sub,
      quelle: d.quelle,
      angenommen_von: d.angenommenVon ?? null,
    },
    dokument_id: ab.id,
    created_by: userId,
  });

  return {
    ok: true,
    neu: true,
    meldung: `Auftrag ausgelöst. AB, ${
      reNummer ? "Anzahlungsrechnung" : "keine Anzahlung"
    }, Materialliste und ${gates.length} Gates stehen bereit.`,
  };
}

function fmt(n: number): string {
  return `${n.toLocaleString("de-AT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

type PosRoh = {
  id: string;
  sort: number;
  gruppe_id: string | null;
  rabatt_prozent: string | null;
  optional: boolean;
  article_id: string | null;
  bezeichnung: string;
  menge: string;
  einheit: string;
  ep_netto: string;
  ust_satz: string;
  kalk_stunden: string | null;
  kalk_ek: string | null;
  ist_material: boolean;
  bild_url: string | null;
  beschreibung: string | null;
  kunden_auswahl: string | null;
  upgrade_article_id: string | null;
  upgrade_kategorie: string | null;
  upgrade_aufpreis: string | null;
  upgrade_text: string | null;
};
