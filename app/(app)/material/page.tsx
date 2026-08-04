import type { Metadata } from "next";
import Link from "next/link";
import { Baustellenlieferung } from "@/components/material/Baustellenlieferung";
import { Beladeblock } from "@/components/material/Beladeblock";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { date, num, viennaDay } from "@/lib/format";
import { beladeliste, nachfuellliste } from "@/lib/material/beladeliste";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time";
import { Abholung } from "./Abholung";

export const metadata: Metadata = { title: "Lager" };

/**
 * Die Lageransicht.
 *
 * Der Tag des Lagers in der Reihenfolge, in der er passiert: erst was
 * heute rausgeht, dann was reinkommt, dann was nachzufüllen ist. Keine
 * Beträge auf Vorgangsebene — das Lager kommissioniert, es kalkuliert
 * nicht.
 *
 * Vorher stand hier eine Liste offener Material-Gates zum Abhaken. Das
 * Gate rechnet sich inzwischen aus der Bedarfsliste; ein Häkchen dafür
 * wäre eine Behauptung ohne Deckung.
 */
export default async function MaterialPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const me = await requireMe();
  const { tag: wahl } = await searchParams;
  const supabase = await createClient();

  const heute = viennaDay();
  const tag = wahl === "morgen" ? addDays(heute, 1) : heute;
  const darfBuchen = me.perms.lager === "write" || me.perms.pipelines === "write";

  const [
    liste,
    { data: fahrzeuge },
    { data: offeneBestellungen },
    { data: lieferanten },
    { data: artikel },
    { data: orte },
  ] = await Promise.all([
    beladeliste(supabase, { companyId: me.companyId, tag }),
    /* Fällige Zählungen — der Termin steht am Lagerort, nicht am Fahrzeug. */
    supabase
      .from("lagerort")
      .select("id, name, art, letzte_inventur, inventur_intervall_tage")
      .eq("aktiv", true)
      .order("sort"),
    supabase
      .from("bestellung")
      .select(
        `id, nummer, status, ziel, wunschtermin,
         lieferant:lieferant_id ( name ),
         positionen:bestellposition ( menge, gelieferte_menge, storniert, bestaetigter_termin )`,
      )
      .in("status", ["bestellt", "teilgeliefert"])
      .order("wunschtermin", { nullsFirst: false }),
    supabase.from("supplier").select("id, name").order("name"),
    supabase
      .from("article")
      .select("id, sku, name")
      .eq("active", true)
      .neq("typ", "nicht_bestandsgefuehrt")
      .order("name")
      .limit(600),
    supabase.from("lagerort").select("id, name").eq("art", "fahrzeug").order("sort"),
  ]);

  /* Die Nachfüll-Listen aller Fahrzeuge, nicht nur des einen im Einsatz. */
  const nachfuellen: {
    ort: string;
    name: string;
    zeilen: Awaited<ReturnType<typeof nachfuellliste>>;
  }[] = [];
  for (const o of (orte ?? []) as unknown as { id: string; name: string }[]) {
    const zeilen = await nachfuellliste(supabase, o.id);
    if (zeilen.length > 0) nachfuellen.push({ ort: o.id, name: o.name, zeilen });
  }

  const erwartet = ((offeneBestellungen ?? []) as unknown as {
    id: string;
    nummer: string | null;
    status: string;
    ziel: string;
    wunschtermin: string | null;
    lieferant: { name: string } | null;
    positionen: {
      menge: string;
      gelieferte_menge: string;
      storniert: boolean;
      bestaetigter_termin: string | null;
    }[];
  }[]).map((b) => {
    const offen = b.positionen.filter(
      (p) => !p.storniert && Number(p.gelieferte_menge) < Number(p.menge),
    );
    const termine = offen
      .map((p) => p.bestaetigter_termin)
      .filter((t): t is string => Boolean(t))
      .sort();
    const termin = termine[0] ?? b.wunschtermin;
    return {
      id: b.id,
      nummer: b.nummer,
      ziel: b.ziel,
      lieferant: b.lieferant?.name ?? "—",
      termin,
      /* Überfällig heisst: der zugesagte Tag ist vorbei und nichts kam an. */
      ueberfaellig: Boolean(termin && termin < heute),
    };
  });

  const ueberfaellig = erwartet.filter((e) => e.ueberfaellig);

  const inventurFaellig = ((fahrzeuge ?? []) as unknown as {
    id: string;
    name: string;
    art: string;
    letzte_inventur: string | null;
    inventur_intervall_tage: number;
  }[]).filter(
    (f) =>
      f.art === "fahrzeug" &&
      (!f.letzte_inventur ||
        addDays(f.letzte_inventur, f.inventur_intervall_tage) <= heute),
  );

  return (
    <>
      <PageHeader
        title="Lager"
        subtitle="Kommissionieren, einbuchen, nachfüllen"
        actions={
          <>
            <Link
              href="/material/bestand"
              className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
            >
              Bestand
            </Link>
            <Link
              href="/bestellungen"
              className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
            >
              Bestellungen
            </Link>
          </>
        }
      />

      {ueberfaellig.length > 0 ? (
        <section className="mb-4 rounded-[20px] bg-s-crit/10 p-5">
          <h2 className="text-[15px] font-semibold text-s-crit">
            {ueberfaellig.length}{" "}
            {ueberfaellig.length === 1 ? "Lieferung ist" : "Lieferungen sind"}{" "}
            überfällig
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {ueberfaellig.map((e) => (
              <li key={e.id} className="text-[12.5px] text-s-crit">
                <Link href={`/bestellungen/${e.id}`} className="underline">
                  {e.nummer}
                </Link>{" "}
                · {e.lieferant} · zugesagt {e.termin ? date(e.termin) : "—"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["heute", "Heute"],
          ["morgen", "Morgen"],
        ].map(([wert, label]) => (
          <Link
            key={wert}
            href={`/material?tag=${wert}`}
            className={[
              "rounded-pill px-4 py-[9px] text-[12.5px] font-medium",
              (wahl === "morgen" ? "morgen" : "heute") === wert
                ? "bg-ink text-app hover:text-app"
                : "border border-line bg-surface text-ink hover:bg-sunk hover:text-ink",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {liste.lieferungen.length > 0 ? (
            <Baustellenlieferung lieferungen={liste.lieferungen} touch={false} />
          ) : null}

          <h2 className="text-[15px] font-semibold">
            Kommissionieren{" "}
            <span className="num font-normal text-muted">
              ({liste.bloecke.length})
            </span>
          </h2>

          {liste.bloecke.length === 0 ? (
            <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
              Für diesen Tag ist kein Einsatz mit Material geplant.
            </p>
          ) : (
            liste.bloecke.map((b) => (
              <Beladeblock
                key={b.vorgangId}
                block={b}
                kommissionieren={darfBuchen}
                touch={false}
              />
            ))
          )}
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-2 text-[15px] font-semibold">Erwartet</h2>
            {erwartet.length === 0 ? (
              <p className="text-[12.5px] text-muted">Nichts unterwegs.</p>
            ) : (
              <ul className="flex flex-col gap-[5px]">
                {erwartet.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/bestellungen/${e.id}`}
                      className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-panel px-3 py-[9px] transition-colors hover:border-accent"
                    >
                      <span className="num text-[12.5px] font-semibold">
                        {e.nummer}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                        {e.lieferant}
                      </span>
                      {e.ziel === "baustelle" ? (
                        <Pill tone="waiting">Baustelle</Pill>
                      ) : null}
                      <span
                        className={`num text-[11.5px] ${
                          e.ueberfaellig ? "text-s-crit" : "text-faint"
                        }`}
                      >
                        {e.termin ? date(e.termin) : "ohne Termin"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {nachfuellen.length > 0 ? (
            <section className="rounded-[20px] bg-surface p-5 shadow-soft">
              <h2 className="mb-2 text-[15px] font-semibold">Nachfüllen</h2>
              {nachfuellen.map((f) => (
                <div key={f.ort} className="mb-3 last:mb-0">
                  <p className="mb-1 text-[12px] font-semibold text-muted">
                    {f.name}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {f.zeilen.map((z) => (
                      <li
                        key={z.artikelId}
                        className="flex items-center gap-3 rounded-input bg-panel px-3 py-2 text-[12.5px]"
                      >
                        <span className="num w-[64px] shrink-0 text-right font-semibold">
                          {num(z.soll - z.bestand)}
                        </span>
                        <span className="w-[30px] shrink-0 text-[11px] text-faint">
                          {z.einheit}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {z.bezeichnung}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <Link
                href="/material/bestand"
                className="text-[12.5px] font-semibold text-accent-ink underline"
              >
                Nachschub umbuchen
              </Link>
            </section>
          ) : null}

          {inventurFaellig.length > 0 ? (
            <section className="rounded-[20px] bg-surface p-5 shadow-soft">
              <h2 className="mb-1 text-[15px] font-semibold">Inventur fällig</h2>
              <p className="mb-2 text-[12.5px] text-muted">
                Zehn bis fünfzehn Artikel, unter fünf Minuten.
              </p>
              <ul className="flex flex-col gap-1">
                {inventurFaellig.map((f) => (
                  <li key={f.id}>
                    <Link
                      href={`/material/inventur?ort=${f.id}`}
                      className="text-[12.5px] text-accent-ink underline"
                    >
                      {f.name}
                      {f.letzte_inventur
                        ? ` · zuletzt ${date(f.letzte_inventur)}`
                        : " · noch nie gezählt"}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {darfBuchen ? (
            <Abholung
              lieferanten={(lieferanten ?? []).map((l) => ({
                id: l.id as string,
                name: l.name as string,
              }))}
              artikel={
                (artikel ?? []) as unknown as {
                  id: string;
                  sku: string;
                  name: string;
                }[]
              }
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
