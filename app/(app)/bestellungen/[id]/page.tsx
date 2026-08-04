import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { date } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Bestelldetail } from "./Bestelldetail";

export const metadata: Metadata = { title: "Bestellung" };

export default async function BestellungPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;
  const supabase = await createClient();
  const darfSchreiben =
    me.perms.pipelines === "write" || me.perms.lager === "write";

  const { data: b } = await supabase
    .from("bestellung")
    .select(
      `id, nummer, status, ziel, ziel_vorgang_id, abholung, extern_bestellt,
       wunschtermin, notiz, created_at, bestellt_am,
       lieferant:lieferant_id ( id, name, email )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!b) notFound();

  const [{ data: posRoh }, { data: lieferanten }, { data: vorgaenge }, { data: artikel }, { data: dokumente }] =
    await Promise.all([
      supabase
        .from("bestellposition")
        .select(
          `id, bezeichnung, menge, einheit, gelieferte_menge, storniert,
           bestaetigter_termin, artikel:artikel_id ( sku ),
           vorgang:vorgang_id ( number )`,
        )
        .eq("bestellung_id", id)
        .order("sort"),
      supabase.from("supplier").select("id, name").order("name"),
      supabase
        .from("vorgang")
        .select("id, number, customer:customer_id ( name )")
        .in("phase", ["beauftragt", "montage"])
        .order("number", { ascending: false })
        .limit(100),
      supabase
        .from("article")
        .select("id, sku, name")
        .eq("active", true)
        .neq("typ", "nicht_bestandsgefuehrt")
        .order("name")
        .limit(600),
      supabase
        .from("bestellung_dokument")
        .select("id, art, dateiname, created_at")
        .eq("bestellung_id", id)
        .order("created_at", { ascending: false }),
    ]);

  const lieferant = b.lieferant as unknown as {
    id: string;
    name: string;
    email: string | null;
  } | null;

  const positionen = ((posRoh ?? []) as unknown as {
    id: string;
    bezeichnung: string;
    menge: string;
    einheit: string;
    gelieferte_menge: string;
    storniert: boolean;
    bestaetigter_termin: string | null;
    artikel: { sku: string } | null;
    vorgang: { number: string } | null;
  }[]).map((p) => ({
    id: p.id,
    sku: p.artikel?.sku ?? null,
    bezeichnung: p.bezeichnung,
    menge: Number(p.menge),
    einheit: p.einheit,
    geliefert: Number(p.gelieferte_menge),
    storniert: p.storniert,
    termin: p.bestaetigter_termin,
    vorgangNummer: p.vorgang?.number ?? null,
  }));

  const belege = (dokumente ?? []) as unknown as {
    id: string;
    art: string;
    dateiname: string | null;
    created_at: string;
  }[];

  return (
    <>
      <PageHeader
        title={(b.nummer as string | null) ?? "Bestellung (Entwurf)"}
        subtitle={`${lieferant?.name ?? "kein Lieferant"} · angelegt ${date(b.created_at as string)}`}
        actions={
          <Link
            href="/bestellungen"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zur Übersicht
          </Link>
        }
      />

      <Bestelldetail
        kopf={{
          id: b.id as string,
          nummer: (b.nummer as string | null) ?? null,
          status: b.status as string,
          ziel: b.ziel as string,
          zielVorgangId: (b.ziel_vorgang_id as string | null) ?? null,
          abholung: Boolean(b.abholung),
          externBestellt: Boolean(b.extern_bestellt),
          wunschtermin: (b.wunschtermin as string | null) ?? null,
          notiz: (b.notiz as string | null) ?? null,
          lieferantId: lieferant?.id ?? null,
          lieferantName: lieferant?.name ?? null,
          lieferantMail: lieferant?.email ?? null,
        }}
        positionen={positionen}
        lieferanten={(lieferanten ?? []).map((l) => ({
          id: l.id as string,
          name: l.name as string,
        }))}
        vorgaenge={((vorgaenge ?? []) as unknown as {
          id: string;
          number: string;
          customer: { name: string } | null;
        }[]).map((v) => ({
          id: v.id,
          label: `${v.number} · ${v.customer?.name ?? ""}`,
        }))}
        artikel={((artikel ?? []) as unknown as {
          id: string;
          sku: string;
          name: string;
        }[])}
        darfSchreiben={darfSchreiben}
      />

      {belege.length > 0 ? (
        <section className="mt-4 rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-2 text-[15px] font-semibold">Belege</h2>
          <ul className="flex flex-col gap-[5px]">
            {belege.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-card border border-line bg-panel px-3 py-[9px]"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {d.dateiname ?? d.art}
                </span>
                <span className="num text-[11.5px] text-faint">
                  {date(d.created_at)}
                </span>
                <a
                  href={`/api/bestellung/${b.id as string}/dokument/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-pill border border-line bg-surface px-[12px] py-[5px] text-[11.5px] text-ink transition-colors hover:bg-sunk"
                >
                  Öffnen
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
