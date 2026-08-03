import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { LieferantForm } from "../ArtikelForms";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, eur, num } from "@/lib/format";
import { buildProposal } from "@/lib/procurement";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ProposalTable } from "./ProposalTable";
import { OrderActions } from "./OrderActions";

export const metadata: Metadata = { title: "Bestellungen" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  open: "gesendet",
  confirmed: "bestätigt",
  shipped: "unterwegs",
  received: "geliefert",
};

export default async function BestellungenPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const [lines, { data: lieferanten }, { data: orders }] = await Promise.all([
    buildProposal(),
    supabase
      .from("supplier")
      .select("id, name, email, phone, customer_number, framework_contract")
      .order("name"),
    supabase
      .from("purchase_order")
      .select(
        `id, number, status, due_date, sent_at, created_at,
         supplier:supplier_id ( id, name, email ),
         items:purchase_order_item ( id, qty, price, received_qty, article:article_id ( sku, name, unit ) )`,
      )
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const offeneBestellungen = (orders ?? []).filter(
    (o) => o.status !== "received",
  );
  const bedarfsWert = lines.reduce((s, l) => s + l.fehlmenge * l.preis, 0);
  const fuerAuftrag = lines.filter((l) => l.grund !== "mindestbestand");

  return (
    <>
      <PageHeader
        title="Bestellungen"
        subtitle="Vorschlag aus terminierten Aufträgen und Mindestbestand · Preise exkl. USt."
        actions={
          <Link
            href="/lager"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zum Bestand
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Vorschlagspositionen" value={lines.length} />
        <Stat
          label="Davon für Aufträge"
          value={fuerAuftrag.length}
          tone={fuerAuftrag.length > 0 ? "crit" : "done"}
        />
        <Stat label="Warenwert Vorschlag" value={eur(bedarfsWert)} />
        <Stat label="Offene Bestellungen" value={offeneBestellungen.length} />
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-[15px] font-semibold">Bestellvorschlag</h2>
        {me.perms.lager === "write" ? (
          <ProposalTable
            lines={lines}
            suppliers={(lieferanten ?? []).map((s) => ({
              id: s.id as string,
              name: s.name as string,
            }))}
          />
        ) : (
          <div className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
            Für Bestellungen fehlt deiner Rolle das Schreibrecht.
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">
          Bestellungen{" "}
          <span className="num font-normal text-muted">
            ({(orders ?? []).length})
          </span>
        </h2>

        {(orders ?? []).length === 0 ? (
          <div className="rounded-[20px] bg-surface p-6 text-[13.5px] text-muted shadow-soft">
            Noch keine Bestellung angelegt.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {(orders ?? []).map((o) => {
              const supplier = o.supplier as unknown as {
                name: string;
                email: string | null;
              } | null;
              const items = (o.items ?? []) as unknown as {
                id: string;
                qty: string;
                price: string | null;
                received_qty: string;
                article: { sku: string; name: string; unit: string } | null;
              }[];
              const wert = items.reduce(
                (s, i) => s + Number(i.qty) * Number(i.price ?? 0),
                0,
              );

              return (
                <article
                  key={o.id as string}
                  className="rounded-[20px] bg-surface p-5 shadow-soft"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="num text-[13px] font-semibold">
                      {o.number as string}
                    </span>
                    <Pill
                      tone={
                        o.status === "received"
                          ? "done"
                          : o.status === "draft"
                            ? "neutral"
                            : "doing"
                      }
                    >
                      {STATUS_LABEL[o.status as string] ?? (o.status as string)}
                    </Pill>
                    <span className="flex-1 text-[13px]">
                      {supplier?.name ?? "—"}
                    </span>
                    <span className="num text-[12.5px] text-muted">
                      Termin {date(o.due_date as string | null)}
                    </span>
                    <span className="num text-[13px] font-semibold">
                      {eur(wert)}
                    </span>
                  </div>

                  <ul className="mt-3 flex flex-col gap-2">
                    {items.map((i) => {
                      const offen = Number(i.qty) - Number(i.received_qty);
                      return (
                        <li
                          key={i.id}
                          className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-[10px]"
                        >
                          <span className="num w-[120px] shrink-0 text-[12px] text-muted">
                            {i.article?.sku ?? "—"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px]">
                            {i.article?.name ?? "—"}
                          </span>
                          <span className="num text-[12.5px]">
                            {num(i.qty)} {i.article?.unit ?? ""}
                          </span>
                          <span
                            className={`num text-[12.5px] ${offen > 0 ? "text-muted" : "text-s-done"}`}
                          >
                            {offen > 0 ? `${num(offen)} offen` : "geliefert"}
                          </span>
                          {me.perms.lager === "write" && offen > 0 ? (
                            <OrderActions
                              mode="receive"
                              orderId={o.id as string}
                              itemId={i.id}
                              defaultQty={offen}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  {me.perms.lager === "write" && o.status === "draft" ? (
                    <div className="mt-3">
                      <OrderActions mode="send" orderId={o.id as string} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/*
        Lieferanten anlegen und pflegen. Das Formular gab es, es war nur
        nirgends eingebunden — ohne Lieferant lässt sich keine Bestellung
        senden, und ohne Weg zum Anlegen war der Bestellvorschlag eine
        Sackgasse.
      */}
      {me.perms.lager === "write" ? (
        <section className="mt-6 grid gap-4 xl:grid-cols-[1fr_1fr] xl:items-start">
          <LieferantForm />

          <div className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-3 text-[15px] font-semibold">
              Lieferanten
              <span className="num ml-2 rounded-pill bg-sunk px-[8px] py-[2px] text-[11px] font-normal text-muted">
                {(lieferanten ?? []).length}
              </span>
            </h2>
            {(lieferanten ?? []).length === 0 ? (
              <p className="text-[13px] text-muted">
                Noch kein Lieferant angelegt. Ohne Lieferant lässt sich keine
                Bestellung versenden.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(lieferanten ?? []).map((l) => (
                  <li
                    key={l.id as string}
                    className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                  >
                    <span className="text-[13.5px] font-medium">
                      {l.name as string}
                    </span>
                    <span className="num min-w-0 flex-1 truncate text-[12px] text-muted">
                      {(l.email as string | null) ?? "keine Mailadresse"}
                    </span>
                    {l.framework_contract ? (
                      <span className="rounded-pill bg-s-done/12 px-[9px] py-[3px] text-[11px] text-s-done">
                        Rahmenvertrag
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11.5px] text-faint">
              {"Artikelpreise je Lieferant pflegst du im Artikel unter „Bearbeiten“."}
            </p>
          </div>
        </section>
      ) : null}
    </>
  );
}
