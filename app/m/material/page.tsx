import type { Metadata } from "next";
import Link from "next/link";
import { Pill } from "@/components/ui/Pill";
import { Baustellenlieferung } from "@/components/material/Baustellenlieferung";
import { Beladeblock } from "@/components/material/Beladeblock";
import { num, viennaDay } from "@/lib/format";
import { beladeliste } from "@/lib/material/beladeliste";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time";

export const metadata: Metadata = { title: "Material" };

/**
 * Die Beladeliste des Monteurs.
 *
 * Sie beantwortet drei Fragen vor der Abfahrt: Was lade ich? Wofür? Was
 * fehlt? Der Umschalter auf morgen ist kein Komfort — wer abends noch
 * lädt, spart am Morgen eine halbe Stunde, und die Buchung passiert
 * sofort, weil das Material dann tatsächlich weg ist.
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
  const morgen = addDays(heute, 1);
  const tag = wahl === "morgen" ? morgen : heute;

  const liste = await beladeliste(supabase, {
    companyId: me.companyId,
    tag,
    userId: me.id,
  });

  const offen = liste.bloecke.reduce((s, b) => s + b.zuLaden.length, 0);
  const fehlt = liste.bloecke.reduce((s, b) => s + b.fehlt.length, 0);

  return (
    <>
      <h1 className="mb-1 text-[24px] font-bold tracking-[-0.02em]">Beladen</h1>
      <p className="mb-4 text-[13px] text-muted">
        {liste.fahrzeug ? `${liste.fahrzeug.name} · ` : ""}
        {offen === 0 ? "nichts mehr zu laden" : `${offen} Positionen`}
        {fehlt > 0 ? ` · ${fehlt} fehlen` : ""}
      </p>

      <div className="mb-4 flex gap-2">
        {[
          ["heute", "Heute"],
          ["morgen", "Morgen"],
        ].map(([wert, label]) => (
          <Link
            key={wert}
            href={`/m/material?tag=${wert}`}
            className={[
              "min-h-[44px] flex-1 rounded-pill px-4 py-[11px] text-center text-[14px] font-semibold",
              (wahl === "morgen" ? "morgen" : "heute") === wert
                ? "bg-ink text-app hover:text-app"
                : "border border-line bg-surface text-ink hover:text-ink",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
      </div>

      {liste.nachfuellen.length > 0 ? (
        <section className="mb-4 rounded-[20px] bg-s-warn/12 p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-accent-ink">
              {liste.fahrzeug?.name ?? "Fahrzeug"} nachfüllen
            </h2>
            <Pill tone="warn">{liste.nachfuellen.length}</Pill>
          </div>
          <ul className="flex flex-col gap-1">
            {liste.nachfuellen.map((n) => (
              <li
                key={n.artikelId}
                className="flex items-center gap-3 text-[13px] text-accent-ink"
              >
                <span className="num w-[70px] shrink-0 text-right font-semibold">
                  {num(n.soll - n.bestand)}
                </span>
                <span className="w-[34px] shrink-0 text-[11.5px]">{n.einheit}</span>
                <span className="min-w-0 flex-1 truncate">{n.bezeichnung}</span>
                <span className="num text-[11.5px]">
                  {num(n.bestand)} von {num(n.min)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {liste.lieferungen.length > 0 ? (
        <div className="mb-4">
          <Baustellenlieferung lieferungen={liste.lieferungen} touch />
        </div>
      ) : null}

      {liste.bloecke.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
          {wahl === "morgen"
            ? "Für morgen ist noch nichts geplant."
            : "Heute steht kein Einsatz mit Material an."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {liste.bloecke.map((b) => (
            <Beladeblock key={b.vorgangId} block={b} kommissionieren={false} touch />
          ))}
        </div>
      )}
    </>
  );
}
