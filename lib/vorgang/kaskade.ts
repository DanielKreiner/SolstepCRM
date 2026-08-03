import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anzahlung, summen } from "@/lib/vorgang/modell";

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
    .select("id, number, phase")
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
      "id, sort, article_id, bezeichnung, menge, einheit, ep_netto, ust_satz, kalk_stunden, kalk_ek, ist_material, bild_url, beschreibung",
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

  const { anzahlungBrutto } = anzahlung(s.brutto, d.anzahlungProzent);

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
      betrag_netto: s.netto,
      betrag_brutto: s.brutto,
      status: "entwurf",
      created_by: userId,
    })
    .select("id")
    .single();

  if (abFehler || !ab) {
    return { ok: false, grund: `Auftragsbestätigung fehlgeschlagen: ${abFehler?.message}` };
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
      article_id: p.article_id,
      bezeichnung: p.bezeichnung,
      menge: p.menge,
      einheit: p.einheit,
      ep_netto: p.ep_netto,
      ust_satz: p.ust_satz,
      kalk_stunden: p.kalk_stunden,
      kalk_ek: p.kalk_ek,
      ist_material: p.ist_material,
      bild_url: p.bild_url,
      beschreibung: p.beschreibung,
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
        betrag_netto: Math.round((anzahlungBrutto / 1.2) * 100) / 100,
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
      auftragswert_netto: s.netto,
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
    `Auftragswert ${fmt(s.netto)} netto.`,
    `Auftragsbestätigung ${v.number as string} erzeugt.`,
    reNummer
      ? `Anzahlungsrechnung ${reNummer} über ${fmt(anzahlungBrutto)} brutto (${d.anzahlungProzent} %) als Entwurf.`
      : "Keine Anzahlung vereinbart.",
    material.length > 0
      ? `Materialbedarf über ${material.length} Positionen, ${fmt(s.materialEk)} Einkauf.`
      : "Kein Material im Auftrag.",
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
};
