import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { date, eur, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { GATE_STATUS_LABEL, type GateStatus } from "@/lib/vorgang/modell";
import { MaterialGate } from "./MaterialForms";

export const metadata: Metadata = { title: "Material" };

/**
 * Die Lager-Ansicht.
 *
 * Alle Vorgänge, deren Material-Gate noch nicht durch ist — mit dem, was
 * zu bestellen wäre. Das Lager arbeitet daran und hakt ab; sonst ist die
 * Ansicht lesend (Briefing Abschnitt 6).
 *
 * Kein Lagerbestand, kein Wareneingang. Gate plus Liste reicht, und alles
 * Weitere steht ausdrücklich nicht im Auftrag (Abschnitt 8).
 */
export default async function MaterialPage({
  searchParams,
}: {
  searchParams: Promise<{ alle?: string }>;
}) {
  const me = await requireMe();
  const { alle: alleZeigen } = await searchParams;
  const supabase = await createClient();

  const { data: gates } = await supabase
    .from("vorgang_gate")
    .select(
      `id, status, faellig_am, vorgang:vorgang_id (
         id, number, phase, ort, kwp, customer:customer_id ( name )
       )`,
    )
    .eq("key", "material")
    .order("faellig_am", { nullsFirst: false });

  type Zeile = {
    id: string;
    status: GateStatus;
    faellig_am: string | null;
    vorgang: {
      id: string;
      number: string;
      phase: string;
      ort: string | null;
      kwp: string | null;
      customer: { name: string } | null;
    } | null;
  };

  const alleGates = ((gates ?? []) as unknown as Zeile[]).filter((g) => g.vorgang);
  const offen = alleGates.filter(
    (g) => g.status !== "erledigt" && g.status !== "nicht_noetig",
  );
  const sichtbar = alleZeigen === "1" ? alleGates : offen;

  /*
   * Die Materialpositionen der offenen Vorgänge. Nur was als Material
   * markiert ist — Montagestunden bestellt niemand beim Grosshändler.
   */
  const ids = sichtbar.map((g) => g.vorgang!.id);
  const { data: positionen } = ids.length
    ? await supabase
        .from("vorgang_position")
        .select("vorgang_id, bezeichnung, menge, einheit, kalk_ek, bild_url")
        .in("vorgang_id", ids)
        .eq("ist_material", true)
        .is("dokument_id", null)
        .order("sort")
    : { data: [] };

  const jeVorgang = new Map<
    string,
    { bezeichnung: string; menge: number; einheit: string; ek: number; bild: string | null }[]
  >();
  for (const p of (positionen ?? []) as unknown as {
    vorgang_id: string;
    bezeichnung: string;
    menge: string;
    einheit: string;
    kalk_ek: string | null;
    bild_url: string | null;
  }[]) {
    const liste = jeVorgang.get(p.vorgang_id) ?? [];
    liste.push({
      bezeichnung: p.bezeichnung,
      menge: Number(p.menge),
      einheit: p.einheit,
      ek: Number(p.kalk_ek ?? 0),
      bild: p.bild_url,
    });
    jeVorgang.set(p.vorgang_id, liste);
  }

  const darfHaken = me.perms.lager === "write" || me.perms.pipelines === "write";

  return (
    <>
      <PageHeader
        title="Material"
        subtitle="Vorgänge, deren Material noch nicht bestellt und bestätigt ist"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["", `Offen · ${offen.length}`],
          ["1", `Alle · ${alleGates.length}`],
        ].map(([wert, label]) => (
          <Link
            key={label}
            href={wert ? "/material?alle=1" : "/material"}
            className={[
              "rounded-pill px-4 py-[9px] text-[12.5px] font-medium",
              (alleZeigen === "1") === (wert === "1")
                ? "bg-ink text-app hover:text-app"
                : "border border-line bg-surface text-ink hover:bg-sunk hover:text-ink",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
      </div>

      {sichtbar.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
          Nichts offen. Jedes beauftragte Material ist bestellt und bestätigt.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sichtbar.map((g) => {
            const v = g.vorgang!;
            const liste = jeVorgang.get(v.id) ?? [];
            const summe = liste.reduce((a, p) => a + p.menge * p.ek, 0);

            return (
              <li
                key={g.id}
                className="rounded-[20px] bg-surface p-5 shadow-soft"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/vorgaenge/${v.id}`}
                    className="num text-[13px] font-semibold text-ink hover:underline"
                  >
                    {v.number}
                  </Link>
                  <Pill
                    tone={
                      g.status === "erledigt"
                        ? "done"
                        : g.status === "laeuft"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {GATE_STATUS_LABEL[g.status]}
                  </Pill>
                  <span className="text-[12.5px] text-muted">
                    {v.customer?.name ?? "—"}
                    {v.ort ? ` · ${v.ort}` : ""}
                    {v.kwp ? ` · ${num(v.kwp, "kWp")}` : ""}
                  </span>
                  {g.faellig_am ? (
                    <span className="num ml-auto text-[11.5px] text-faint">
                      fällig {date(g.faellig_am)}
                    </span>
                  ) : null}
                </div>

                {liste.length === 0 ? (
                  <p className="mt-3 text-[12.5px] text-muted">
                    Keine Materialpositionen hinterlegt.
                  </p>
                ) : (
                  <>
                    <ul className="mt-3 flex flex-col gap-1">
                      {liste.map((p, i) => (
                        <li
                          key={`${g.id}-${i}`}
                          className="flex items-center gap-3 rounded-input bg-panel px-3 py-2"
                        >
                          {p.bild ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.bild}
                              alt=""
                              loading="lazy"
                              className="h-[28px] w-[28px] shrink-0 rounded-[7px] bg-surface object-contain"
                            />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate text-[12.5px]">
                            {p.bezeichnung}
                          </span>
                          <span className="num shrink-0 text-[12.5px] font-semibold">
                            {num(p.menge)} {p.einheit}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="num mt-2 text-[11.5px] text-faint">
                      {liste.length} Positionen · {eur(summe)} Einkauf kalkuliert
                    </p>
                  </>
                )}

                {darfHaken ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <MaterialGate
                      vorgangId={v.id}
                      gateId={g.id}
                      status={g.status}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
