import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { QuotePdf, type QuotePdfData } from "@/lib/pdf/quote";
import { createClient } from "@/lib/supabase/server";

// @react-pdf braucht Node, nicht Edge. Kein Puppeteer — zu langsam im
// Serverless-Kaltstart (CLAUDE.md 6.4).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Bewusst der RLS-Client: wer das Angebot nicht sehen darf, bekommt auch
  // kein PDF. Kein Service-Role auf diesem Pfad.
  const supabase = await createClient();

  const [{ data: quote }, { data: company }] = await Promise.all([
    supabase
      .from("quote")
      .select(
        `id, number, net_total, valid_until, created_at, planner_payload,
         customer:customer_id ( name, contact_person, address, zip, city )`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("company")
      .select("name, address, zip, city, uid_nr, iban")
      .maybeSingle(),
  ]);

  if (!quote || !company) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const { data: items } = await supabase
    .from("quote_item")
    .select("pos, text, qty, unit, sale_price, vat_rate")
    .eq("quote_id", id)
    .order("pos");

  const customer = quote.customer as unknown as {
    name: string;
    contact_person: string | null;
    address: string | null;
    zip: string | null;
    city: string | null;
  } | null;

  const planung = quote.planner_payload as
    | { anlage?: Record<string, number | string | undefined> }
    | null;
  const a = planung?.anlage;

  const data: QuotePdfData = {
    number: quote.number as string,
    company: {
      name: company.name as string,
      address: (company.address as string | null) ?? null,
      zip: (company.zip as string | null) ?? null,
      city: (company.city as string | null) ?? null,
      uid: (company.uid_nr as string | null) ?? null,
      iban: (company.iban as string | null) ?? null,
    },
    customer: {
      name: customer?.name ?? "—",
      contact: customer?.contact_person ?? null,
      address: customer?.address ?? null,
      zip: customer?.zip ?? null,
      city: customer?.city ?? null,
    },
    validUntil: (quote.valid_until as string | null) ?? null,
    createdAt: quote.created_at as string,
    plant: a
      ? {
          kwp: numOrUndef(a.kwp),
          speicher: numOrUndef(a.speicher_kwh),
          module: strOrUndef(a.module),
          wechselrichter: strOrUndef(a.wechselrichter),
          ertrag: numOrUndef(a.ertrag_kwh_jahr),
          co2: numOrUndef(a.co2_kg_jahr),
        }
      : null,
    items: (items ?? []).map((it) => ({
      pos: it.pos as number,
      text: it.text as string,
      qty: Number(it.qty),
      unit: it.unit as string,
      salePrice: Number(it.sale_price),
      vatRate: Number(it.vat_rate),
    })),
    netTotal: Number(quote.net_total),
  };

  const buffer = await renderToBuffer(<QuotePdf data={data} />);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Angebot-${data.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
