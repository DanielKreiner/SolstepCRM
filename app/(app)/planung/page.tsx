import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { dateShort, time, viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, isoWeek, startOfViennaWeek } from "@/lib/time";

export const metadata: Metadata = { title: "Planung" };

/**
 * Das Planungsboard — zweite Ansicht auf dieselben Termine.
 *
 * Terminiert wird im Vorgang. Hier sieht man das Ergebnis über alle
 * Vorgänge hinweg: Zeilen sind Mitarbeiter, Spalten sind Tage, Blöcke
 * sind Termine. Ein Klick führt zurück in den Vorgang, weil dort die
 * Arbeit passiert.
 *
 * Kein eigenes Kalendermodul und kein Sync — das steht ausdrücklich
 * nicht im Auftrag (Briefing Abschnitt 8).
 */
export default async function PlanungPage({
  searchParams,
}: {
  searchParams: Promise<{ woche?: string }>;
}) {
  await requireMe();
  const { woche } = await searchParams;
  const supabase = await createClient();

  const montag = startOfViennaWeek(
    woche && /^\d{4}-\d{2}-\d{2}$/.test(woche) ? woche : viennaDay(),
  );
  const tage = Array.from({ length: 7 }, (_, i) => addDays(montag, i));

  const von = new Date(`${montag}T00:00:00.000Z`).toISOString();
  const bis = new Date(`${addDays(montag, 7)}T00:00:00.000Z`).toISOString();

  const [{ data: leute }, { data: termine }] = await Promise.all([
    supabase
      .from("app_user")
      .select("id, name, role")
      .eq("active", true)
      .in("role", ["monteur", "bauleitung", "lager"])
      .order("name"),
    supabase
      .from("vorgang_termin")
      .select(
        `id, art, von, bis, sub_text, notiz,
         vorgang:vorgang_id ( id, number, ort, phase, customer:customer_id ( name ) ),
         personen:vorgang_termin_person ( user_id )`,
      )
      .gte("von", von)
      .lt("von", bis)
      .order("von"),
  ]);

  type Termin = {
    id: string;
    art: string;
    von: string;
    bis: string;
    sub_text: string | null;
    notiz: string | null;
    vorgang: {
      id: string;
      number: string;
      ort: string | null;
      phase: string;
      customer: { name: string } | null;
    } | null;
    personen: { user_id: string }[] | null;
  };

  const alle = (termine ?? []) as unknown as Termin[];
  const ohneZuordnung = alle.filter((t) => (t.personen ?? []).length === 0);

  return (
    <>
      <PageHeader
        title="Planung"
        subtitle={`${isoWeek(montag)} · ${dateShort(montag)} – ${dateShort(addDays(montag, 6))}`}
        actions={
          <div className="flex items-center gap-1 rounded-pill bg-surface p-1 shadow-soft">
            <Link
              href={`/planung?woche=${addDays(montag, -7)}`}
              className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted hover:text-ink"
            >
              ‹
            </Link>
            <Link
              href="/planung"
              className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted hover:text-ink"
            >
              Diese Woche
            </Link>
            <Link
              href={`/planung?woche=${addDays(montag, 7)}`}
              className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted hover:text-ink"
            >
              ›
            </Link>
          </div>
        }
      />

      {ohneZuordnung.length > 0 ? (
        <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 className="text-[15px] font-semibold">Ohne Zuordnung</h2>
            <Pill tone="warn">{ohneZuordnung.length}</Pill>
          </div>
          <p className="mb-3 text-[12.5px] text-muted">
            Termine, die im Kalender stehen, aber niemandem gehören. Sie
            fallen in der Zeilenansicht sonst durch.
          </p>
          <ul className="flex flex-wrap gap-2">
            {ohneZuordnung.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/vorgaenge/${t.vorgang?.id ?? ""}`}
                  className="block rounded-input bg-panel px-4 py-2 text-[12.5px] text-ink hover:bg-sunk hover:text-ink"
                >
                  <span className="num font-semibold">{t.vorgang?.number}</span>{" "}
                  {t.vorgang?.customer?.name ?? ""}
                  <span className="num ml-2 text-[11px] text-faint">
                    {dateShort(t.von)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-[20px] bg-surface p-4 shadow-soft">
        <div className="min-w-[900px]">
          {/* Kopfzeile */}
          <div className="grid grid-cols-[180px_repeat(7,1fr)] gap-2 border-b border-line pb-2">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
              Person
            </span>
            {tage.map((t) => (
              <span key={t} className="num text-[11.5px] text-muted">
                {dateShort(t)}
              </span>
            ))}
          </div>

          {(leute ?? []).length === 0 ? (
            <p className="py-4 text-[13px] text-muted">Niemand aktiv.</p>
          ) : (
            (leute ?? []).map((u) => {
              const meine = alle.filter((t) =>
                (t.personen ?? []).some((p) => p.user_id === u.id),
              );

              return (
                <div
                  key={u.id as string}
                  className="grid grid-cols-[180px_repeat(7,1fr)] gap-2 border-b border-line py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">
                      {u.name as string}
                    </div>
                    <div className="num text-[11px] text-faint">
                      {meine.length} {meine.length === 1 ? "Einsatz" : "Einsätze"}
                    </div>
                  </div>

                  {tage.map((tag) => {
                    /*
                     * Ein Termin läuft oft über mehrere Tage. Er erscheint
                     * an jedem Tag, den er berührt — sonst sieht man am
                     * Dienstag nicht, dass jemand seit Montag draussen ist.
                     */
                    const heute = meine.filter(
                      (t) =>
                        t.von.slice(0, 10) <= tag && t.bis.slice(0, 10) >= tag,
                    );

                    return (
                      <div key={tag} className="flex flex-col gap-1">
                        {heute.map((t) => (
                          <Link
                            key={t.id}
                            href={`/vorgaenge/${t.vorgang?.id ?? ""}`}
                            className="block rounded-input bg-accent-sunk px-2 py-[6px] text-[11px] text-ink hover:bg-sunk hover:text-ink"
                            title={t.notiz ?? undefined}
                          >
                            <span className="num block font-semibold">
                              {t.vorgang?.number}
                            </span>
                            <span className="block truncate">
                              {t.vorgang?.customer?.name ?? ""}
                            </span>
                            <span className="num block text-[10px] text-faint">
                              {t.von.slice(0, 10) === tag ? time(t.von) : "…"}
                              {t.bis.slice(0, 10) === tag ? `–${time(t.bis)}` : ""}
                            </span>
                          </Link>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      <p className="mt-3 text-[11.5px] text-faint">
        Terminiert wird im Vorgang. Diese Ansicht zeigt dasselbe über alle
        Vorgänge hinweg — ein Klick führt zurück.
      </p>
    </>
  );
}
