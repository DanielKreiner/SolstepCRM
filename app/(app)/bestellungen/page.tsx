import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill, type Tone } from "@/components/ui/Pill";
import { date } from "@/lib/format";
import { offenerBedarf } from "@/lib/material/daten";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Sammelbestellung } from "./Sammelbestellung";

export const metadata: Metadata = { title: "Bestellungen" };

/**
 * Bestellungen.
 *
 * Oben, was fehlt — unten, was läuft. Die Reihenfolge ist Absicht: die
 * Frage im Büro lautet morgens „was muss raus", nicht „was ist gestern
 * rausgegangen".
 */

const TON: Record<string, Tone> = {
  entwurf: "neutral",
  bestellt: "doing",
  teilgeliefert: "warn",
  geliefert: "done",
  storniert: "neutral",
};

const LABEL: Record<string, string> = {
  entwurf: "Entwurf",
  bestellt: "bestellt",
  teilgeliefert: "teilgeliefert",
  geliefert: "geliefert",
  storniert: "storniert",
};

export default async function BestellungenPage() {
  const me = await requireMe();
  const supabase = await createClient();
  const darfSchreiben =
    me.perms.pipelines === "write" || me.perms.lager === "write";

  const [{ data: bestellungen }, { data: lieferanten }, offen] = await Promise.all([
    supabase
      .from("bestellung")
      .select(
        `id, nummer, status, ziel, abholung, extern_bestellt, wunschtermin,
         created_at, bestellt_am,
         lieferant:lieferant_id ( name ),
         positionen:bestellposition ( id )`,
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("supplier").select("id, name").order("name"),
    offenerBedarf(supabase),
  ]);

  const liste = (bestellungen ?? []) as unknown as {
    id: string;
    nummer: string | null;
    status: string;
    ziel: string;
    abholung: boolean;
    extern_bestellt: boolean;
    wunschtermin: string | null;
    created_at: string;
    bestellt_am: string | null;
    lieferant: { name: string } | null;
    positionen: { id: string }[];
  }[];

  /*
   * Vergessene Entwürfe sind gefährlich: im Kopf ist die Ware bestellt,
   * in Wirklichkeit ging nie etwas raus. Nach vierzehn Tagen fragt die
   * Liste nach.
   */
  const grenze = new Date();
  grenze.setDate(grenze.getDate() - 14);
  const alteEntwuerfe = liste.filter(
    (b) => b.status === "entwurf" && new Date(b.created_at) < grenze,
  );

  return (
    <>
      <PageHeader
        title="Bestellungen"
        subtitle="Kein Wareneingang ohne Bestellung — deshalb läuft alles hier durch."
        actions={
          <Link
            href="/material"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zum Lager
          </Link>
        }
      />

      {alteEntwuerfe.length > 0 ? (
        <section className="mb-4 rounded-[20px] bg-s-warn/12 p-5">
          <h2 className="text-[15px] font-semibold text-accent-ink">
            {alteEntwuerfe.length}{" "}
            {alteEntwuerfe.length === 1 ? "Entwurf liegt" : "Entwürfe liegen"} seit
            über zwei Wochen
          </h2>
          <p className="mt-1 text-[12.5px] text-accent-ink">
            Ein Entwurf ist nicht bestellt. Abschicken oder wegwerfen —{" "}
            {alteEntwuerfe.map((b, i) => (
              <span key={b.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/bestellungen/${b.id}`} className="underline">
                  vom {date(b.created_at)}
                </Link>
              </span>
            ))}
            .
          </p>
        </section>
      ) : null}

      {darfSchreiben ? (
        <div className="mb-4">
          <Sammelbestellung
            zeilen={offen.map((z) => ({
              id: z.id,
              vorgangNummer: z.vorgangNummer,
              kunde: z.kunde,
              montageAb: z.montageAb,
              sku: z.sku,
              bezeichnung: z.bezeichnung,
              menge: z.menge,
              einheit: z.einheit,
              bereitsBestellt: z.bereitsBestellt,
              inEntwurf: z.inEntwurf,
            }))}
            lieferanten={(lieferanten ?? []).map((l) => ({
              id: l.id as string,
              name: l.name as string,
            }))}
          />
        </div>
      ) : null}

      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="mb-3 text-[15px] font-semibold">
          Bestellungen{" "}
          <span className="num font-normal text-muted">({liste.length})</span>
        </h2>

        {liste.length === 0 ? (
          <p className="text-[12.5px] text-muted">Noch keine Bestellung.</p>
        ) : (
          <ul className="flex flex-col gap-[6px]">
            {liste.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/bestellungen/${b.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel px-3 py-[10px] transition-colors hover:border-accent"
                >
                  <span className="num w-[110px] shrink-0 text-[13px] font-semibold">
                    {b.nummer ?? "Entwurf"}
                  </span>
                  <span className="min-w-[160px] flex-1 truncate text-[13.5px]">
                    {b.lieferant?.name ?? "kein Lieferant"}
                  </span>
                  <span className="num text-[11.5px] text-faint">
                    {b.positionen.length}{" "}
                    {b.positionen.length === 1 ? "Position" : "Positionen"}
                  </span>
                  {b.ziel === "baustelle" ? (
                    <Pill tone="waiting">Baustelle</Pill>
                  ) : null}
                  {b.abholung ? <Pill tone="neutral">Abholung</Pill> : null}
                  <Pill tone={TON[b.status] ?? "neutral"}>
                    {LABEL[b.status] ?? b.status}
                  </Pill>
                  <span className="num w-[86px] text-right text-[11.5px] text-faint">
                    {date(b.bestellt_am ?? b.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
