import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { markeAus } from "@/lib/marke";
import { BestellungPdf, type BestellPosition } from "@/lib/pdf/bestellung";

/**
 * Eine Bestellung abschicken.
 *
 * Der Statuswechsel entwurf → bestellt ist der einzige Moment, in dem
 * eine Bestellung verbindlich wird. Deshalb hängt hier alles dran: die
 * Prüfungen, die Nummer aus dem Nummernkreis, das PDF als Beleg und —
 * wenn gewünscht — die Mail an den Lieferanten.
 *
 * Danach ist die Bestellung nicht mehr editierbar. Änderungen laufen
 * über Storno der Restmenge oder eine neue Bestellung; nur so bleiben
 * das archivierte PDF und die gebuchten Wareneingänge zueinander
 * konsistent.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type Abschicken = {
  companyId: string;
  bestellungId: string;
  userId: string | null;
  /** Mail an den Lieferanten — der Statuswechsel geht auch ohne. */
  mailSenden: boolean;
};

export type AbschickErgebnis =
  | { ok: true; nummer: string; gemailt: boolean }
  | { ok: false; grund: string };

export async function bestellungAbschicken(
  supabase: Client,
  d: Abschicken,
): Promise<AbschickErgebnis> {
  const { data: b } = await supabase
    .from("bestellung")
    .select(
      `id, nummer, status, ziel, ziel_vorgang_id, abholung, extern_bestellt,
       wunschtermin, notiz, created_at,
       lieferant:lieferant_id ( id, name, email, customer_number )`,
    )
    .eq("id", d.bestellungId)
    .maybeSingle();

  if (!b) return { ok: false, grund: "Bestellung nicht gefunden." };
  if (b.status !== "entwurf") {
    return { ok: false, grund: "Die Bestellung ist bereits abgeschickt." };
  }

  const lieferant = b.lieferant as unknown as {
    id: string;
    name: string;
    email: string | null;
    customer_number: string | null;
  } | null;

  /*
   * Die drei harten Prüfungen. Eine Bestellung ohne Lieferant ist ein
   * Zettel, den niemand bekommt; eine ohne Positionen ist ein Zettel
   * ohne Inhalt; ein Ziel Baustelle ohne Vorgang hat keine Adresse.
   */
  if (!lieferant) {
    return {
      ok: false,
      grund: "Ohne Lieferant lässt sich nichts bestellen. Bitte einen auswählen.",
    };
  }

  const { data: posRoh } = await supabase
    .from("bestellposition")
    .select(
      `id, bezeichnung, menge, einheit, storniert, vorgang_id, artikel_id,
       artikel:artikel_id ( sku ),
       vorgang:vorgang_id ( number )`,
    )
    .eq("bestellung_id", d.bestellungId)
    .eq("storniert", false)
    .order("sort");

  const positionen = (posRoh ?? []) as unknown as {
    id: string;
    bezeichnung: string;
    menge: string;
    einheit: string;
    vorgang_id: string | null;
    artikel_id: string | null;
    artikel: { sku: string } | null;
    vorgang: { number: string } | null;
  }[];

  if (positionen.length === 0) {
    return { ok: false, grund: "Die Bestellung hat keine Position." };
  }

  if (b.ziel === "baustelle" && !b.ziel_vorgang_id) {
    return {
      ok: false,
      grund: "Ziel Baustelle braucht einen Vorgang — von dort kommt die Adresse.",
    };
  }

  /* Die Artikelnummern des Lieferanten, soweit gepflegt. */
  const artikelIds = positionen
    .map((p) => p.artikel_id)
    .filter((a): a is string => Boolean(a));

  const lieferantenNummern = new Map<string, string>();
  if (artikelIds.length > 0) {
    const { data: verknuepft } = await supabase
      .from("article_supplier")
      .select("article_id, lieferanten_artikelnummer")
      .eq("supplier_id", lieferant.id)
      .in("article_id", artikelIds);

    for (const v of (verknuepft ?? []) as unknown as {
      article_id: string;
      lieferanten_artikelnummer: string | null;
    }[]) {
      if (v.lieferanten_artikelnummer) {
        lieferantenNummern.set(v.article_id, v.lieferanten_artikelnummer);
      }
    }
  }

  /* Die Nummer wird erst jetzt gezogen — Entwürfe verbrauchen keine. */
  const { data: nrRoh } = await supabase.rpc("next_number", {
    p_company: d.companyId,
    p_kind: "purchase_order",
  });
  const nummer = typeof nrRoh === "string" ? nrRoh : null;
  if (!nummer) return { ok: false, grund: "Bestellnummer konnte nicht vergeben werden." };

  const lieferadresse = await adresse(supabase, {
    companyId: d.companyId,
    ziel: b.ziel as string,
    vorgangId: (b.ziel_vorgang_id as string | null) ?? null,
  });

  const { data: firma } = await supabase
    .from("company")
    .select(
      "name, rechtsform, address, zip, city, country, uid_nr, firmenbuch_nr, firmenbuch_gericht, email, phone, website, iban, bic, pdf_settings",
    )
    .eq("id", d.companyId)
    .maybeSingle();

  const marke = markeAus(firma?.pdf_settings, firma?.name as string | undefined, [
    firma?.zip as string | null,
    firma?.city as string | null,
  ]);

  const pdfPositionen: BestellPosition[] = positionen.map((p) => ({
    bezeichnung: p.bezeichnung,
    artikelnummer: p.artikel?.sku ?? null,
    lieferantenNummer: p.artikel_id
      ? (lieferantenNummern.get(p.artikel_id) ?? null)
      : null,
    menge: Number(p.menge),
    einheit: p.einheit,
    vorgangNummer: p.vorgang?.number ?? null,
  }));

  const buffer = await renderToBuffer(
    <BestellungPdf
      data={{
        nummer,
        erstelltAm: b.created_at as string,
        wunschtermin: (b.wunschtermin as string | null) ?? null,
        abholung: Boolean(b.abholung),
        externBestellt: Boolean(b.extern_bestellt),
        notiz: (b.notiz as string | null) ?? null,
        marke: { logoUrl: marke.logoUrl, akzent: marke.akzent },
        firma: {
          name: (firma?.name as string) ?? "",
          rechtsform: (firma?.rechtsform as string | null) ?? null,
          adresse: (firma?.address as string | null) ?? null,
          plz: (firma?.zip as string | null) ?? null,
          ort: (firma?.city as string | null) ?? null,
          land: (firma?.country as string | null) ?? null,
          uid: (firma?.uid_nr as string | null) ?? null,
          firmenbuchNr: (firma?.firmenbuch_nr as string | null) ?? null,
          firmenbuchGericht: (firma?.firmenbuch_gericht as string | null) ?? null,
          telefon: (firma?.phone as string | null) ?? null,
          email: (firma?.email as string | null) ?? null,
          website: (firma?.website as string | null) ?? null,
          iban: (firma?.iban as string | null) ?? null,
          bic: (firma?.bic as string | null) ?? null,
        },
        lieferant: {
          name: lieferant.name,
          email: lieferant.email,
          kundennummer: lieferant.customer_number,
        },
        lieferadresse,
        positionen: pdfPositionen,
      }}
    />,
  );

  /*
   * Ablegen und eintragen mit dem Service-Role-Client: der Bucket
   * documents ist für angemeldete Sitzungen gesperrt, und mail_outbox
   * ebenso. Die Rechteprüfung ist in der aufrufenden Serveraktion
   * bereits gelaufen.
   */
  const admin = createAdminClient();
  const dateiname = `Bestellung ${nummer}.pdf`;
  const pfad = `${d.companyId}/bestellung/${d.bestellungId}/${crypto.randomUUID()}-${dateiname}`;

  const { error: uploadFehler } = await admin.storage
    .from("documents")
    .upload(pfad, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadFehler) {
    return { ok: false, grund: `PDF konnte nicht abgelegt werden: ${uploadFehler.message}` };
  }

  /*
   * Erst jetzt der Statuswechsel. Scheitert er, liegt eine Datei zu viel
   * im Speicher — das ist ärgerlich, aber harmlos. Umgekehrt wäre eine
   * abgeschickte Bestellung ohne Beleg entstanden.
   */
  const { error: statusFehler } = await supabase
    .from("bestellung")
    .update({
      status: "bestellt",
      nummer,
      bestellt_am: new Date().toISOString(),
    })
    .eq("id", d.bestellungId)
    .eq("status", "entwurf");

  if (statusFehler) {
    await admin.storage.from("documents").remove([pfad]);
    return { ok: false, grund: `Statuswechsel fehlgeschlagen: ${statusFehler.message}` };
  }

  await admin.from("bestellung_dokument").insert({
    company_id: d.companyId,
    bestellung_id: d.bestellungId,
    art: "bestellung",
    storage_path: pfad,
    dateiname,
    created_by: d.userId,
  });

  let gemailt = false;
  if (d.mailSenden && lieferant.email) {
    gemailt = await anLieferanten(admin, {
      companyId: d.companyId,
      an: lieferant.email,
      nummer,
      firmaName: (firma?.name as string) ?? "",
      wunschtermin: (b.wunschtermin as string | null) ?? null,
      dateiname,
      pdf: buffer,
      zeilen: pdfPositionen.length,
    });
  }

  return { ok: true, nummer, gemailt };
}

/** Wohin geliefert wird — Hauptlager oder Baustelle. */
async function adresse(
  supabase: Client,
  d: { companyId: string; ziel: string; vorgangId: string | null },
): Promise<{ label: string; zeilen: string[] }> {
  if (d.ziel === "baustelle" && d.vorgangId) {
    const { data: v } = await supabase
      .from("vorgang")
      .select("number, adresse, plz, ort, customer:customer_id ( name )")
      .eq("id", d.vorgangId)
      .maybeSingle();

    const kunde = v?.customer as unknown as { name: string } | null;
    return {
      label: "Lieferadresse Baustelle",
      zeilen: [
        kunde?.name ?? "Baustelle",
        (v?.adresse as string | null) ?? "",
        [v?.plz, v?.ort].filter(Boolean).join(" "),
        v?.number ? `Vorgang ${v.number as string}` : "",
      ].filter((z) => z.trim() !== ""),
    };
  }

  const { data: firma } = await supabase
    .from("company")
    .select("name, address, zip, city")
    .eq("id", d.companyId)
    .maybeSingle();

  return {
    label: "Lieferadresse",
    zeilen: [
      (firma?.name as string) ?? "",
      (firma?.address as string | null) ?? "",
      [firma?.zip, firma?.city].filter(Boolean).join(" "),
    ].filter((z) => z.trim() !== ""),
  };
}

/** Die Bestellung als Mail mit PDF im Anhang einreihen. */
async function anLieferanten(
  admin: SupabaseClient,
  d: {
    companyId: string;
    an: string;
    nummer: string;
    firmaName: string;
    wunschtermin: string | null;
    dateiname: string;
    pdf: Buffer;
    zeilen: number;
  },
): Promise<boolean> {
  const { data: postfach } = await admin
    .from("mail_account")
    .select("id")
    .eq("company_id", d.companyId)
    .eq("status", "ok")
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  const termin = d.wunschtermin
    ? new Date(d.wunschtermin).toLocaleDateString("de-AT")
    : null;

  const text = [
    "Guten Tag,",
    "",
    `anbei unsere Bestellung ${d.nummer} über ${d.zeilen} ${
      d.zeilen === 1 ? "Position" : "Positionen"
    }.`,
    termin ? `Wunschtermin für die Lieferung: ${termin}.` : "",
    "",
    "Um eine kurze Auftragsbestätigung mit bestätigtem Liefertermin wird gebeten.",
    "",
    "Freundliche Grüße",
    d.firmaName,
  ]
    .filter((z) => z !== undefined)
    .join("\n");

  const { error } = await admin.from("mail_outbox").insert({
    company_id: d.companyId,
    mail_account_id: postfach?.id ?? null,
    to_addrs: [d.an],
    subject: `Bestellung ${d.nummer}`,
    body_text: text,
    body_html: `<p style="font-size:15px;line-height:1.55;color:#151210;white-space:pre-wrap">${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</p>`,
    attachments: [
      {
        filename: d.dateiname,
        content_base64: d.pdf.toString("base64"),
        mime: "application/pdf",
      },
    ],
    art: "bestellung",
  });

  return !error;
}
