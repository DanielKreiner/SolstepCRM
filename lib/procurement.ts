import "server-only";
import { createClient } from "@/lib/supabase/server";

/*
 * Bestellvorschlag.
 *
 * Bedarf = reservierte Mengen terminierter Aufträge, Deckung = Bestand plus
 * bereits bestellte, noch nicht gelieferte Mengen. Dazu der Mindestbestand
 * als zweite, unabhängige Quelle (CLAUDE.md Meilenstein 4).
 *
 * Bewusst zwei Gründe getrennt ausgewiesen: ein Lagerist will wissen, ob er
 * für einen konkreten Auftrag bestellt oder nur das Regal auffüllt.
 */

export type ProposalLine = {
  articleId: string;
  sku: string;
  name: string;
  unit: string;
  bestand: number;
  reserviert: number;
  bestellt: number;
  mindestbestand: number;
  /** Was fehlt, aufgerundet auf ganze Einheiten. */
  fehlmenge: number;
  grund: "auftrag" | "mindestbestand" | "beides";
  supplierId: string | null;
  supplierName: string | null;
  preis: number;
  lieferTage: number;
  /** Aufträge, für die das Material fehlt. */
  auftraege: string[];
};

export async function buildProposal(): Promise<ProposalLine[]> {
  const supabase = await createClient();

  const [
    { data: articles },
    { data: reservations },
    { data: openOrders },
    { data: links },
  ] = await Promise.all([
    supabase
      .from("article")
      .select("id, sku, name, unit, stock, min_stock")
      .eq("active", true),
    supabase
      .from("stock_reservation")
      .select("article_id, qty, job:job_id ( number, scheduled_from )")
      .is("released_at", null),
    supabase
      .from("purchase_order_item")
      .select("article_id, qty, received_qty, order:purchase_order_id ( status )"),
    supabase
      .from("article_supplier")
      .select(
        "article_id, price, lead_days, supplier:supplier_id ( id, name, email )",
      )
      .order("price"),
  ]);

  const reserviert = new Map<string, { menge: number; auftraege: Set<string> }>();
  for (const r of reservations ?? []) {
    const job = r.job as unknown as {
      number: string;
      scheduled_from: string | null;
    } | null;
    // Nur terminierte Aufträge zählen als Bedarf. Ein Auftrag ohne Termin
    // bindet kein Material, sonst bestellt der Betrieb auf Verdacht.
    if (!job?.scheduled_from) continue;

    const key = r.article_id as string;
    if (!reserviert.has(key)) {
      reserviert.set(key, { menge: 0, auftraege: new Set() });
    }
    const eintrag = reserviert.get(key)!;
    eintrag.menge += Number(r.qty);
    eintrag.auftraege.add(job.number);
  }

  const bestellt = new Map<string, number>();
  for (const o of openOrders ?? []) {
    const status = (o.order as unknown as { status: string } | null)?.status;
    if (!status || status === "received" || status === "draft") continue;
    const offen = Number(o.qty) - Number(o.received_qty);
    if (offen <= 0) continue;
    bestellt.set(
      o.article_id as string,
      (bestellt.get(o.article_id as string) ?? 0) + offen,
    );
  }

  // Günstigster Lieferant je Artikel — die Liste ist nach Preis sortiert.
  const lieferant = new Map<
    string,
    { id: string; name: string; preis: number; tage: number }
  >();
  for (const l of links ?? []) {
    const key = l.article_id as string;
    if (lieferant.has(key)) continue;
    const s = l.supplier as unknown as { id: string; name: string } | null;
    if (!s) continue;
    lieferant.set(key, {
      id: s.id,
      name: s.name,
      preis: Number(l.price),
      tage: Number(l.lead_days),
    });
  }

  const lines: ProposalLine[] = [];

  for (const a of articles ?? []) {
    const id = a.id as string;
    const bestand = Number(a.stock);
    const min = Number(a.min_stock);
    const res = reserviert.get(id);
    const resMenge = res?.menge ?? 0;
    const bestelltMenge = bestellt.get(id) ?? 0;

    const verfuegbar = bestand + bestelltMenge - resMenge;
    const fehltFuerAuftrag = Math.max(0, -verfuegbar);
    const fehltFuerMindest = Math.max(0, min - (bestand + bestelltMenge - resMenge));

    const fehlmenge = Math.ceil(Math.max(fehltFuerAuftrag, fehltFuerMindest));
    if (fehlmenge <= 0) continue;

    const grund: ProposalLine["grund"] =
      fehltFuerAuftrag > 0 && fehltFuerMindest > fehltFuerAuftrag
        ? "beides"
        : fehltFuerAuftrag > 0
          ? "auftrag"
          : "mindestbestand";

    const sup = lieferant.get(id);

    lines.push({
      articleId: id,
      sku: a.sku as string,
      name: a.name as string,
      unit: a.unit as string,
      bestand,
      reserviert: resMenge,
      bestellt: bestelltMenge,
      mindestbestand: min,
      fehlmenge,
      grund,
      supplierId: sup?.id ?? null,
      supplierName: sup?.name ?? null,
      preis: sup?.preis ?? 0,
      lieferTage: sup?.tage ?? 0,
      auftraege: [...(res?.auftraege ?? [])].sort(),
    });
  }

  return lines.sort((a, b) => {
    if (a.grund !== b.grund) return a.grund === "auftrag" ? -1 : 1;
    return b.fehlmenge * b.preis - a.fehlmenge * a.preis;
  });
}

/** CSV für die Bestellmail an den Lieferanten. */
export function proposalCsv(
  lines: { sku: string; name: string; qty: number; unit: string; price: number }[],
): string {
  const kopf = "Artikelnummer;Bezeichnung;Menge;Einheit;Preis";
  const zeilen = lines.map((l) =>
    [
      csvFeld(l.sku),
      csvFeld(l.name),
      String(l.qty).replace(".", ","),
      csvFeld(l.unit),
      l.price.toFixed(2).replace(".", ","),
    ].join(";"),
  );
  // BOM, sonst zerlegt Excel unter Windows die Umlaute.
  return `﻿${[kopf, ...zeilen].join("\r\n")}\r\n`;
}

function csvFeld(v: string): string {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
