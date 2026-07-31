import type { Metadata } from "next";
import Link from "next/link";
import { Pill } from "@/components/ui/Pill";
import { dateShort, viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Aufträge" };

/*
 * Auftragsliste der Monteur-App (SPEC 6.1, Bottom-Nav "Aufträge").
 *
 * Anders als /m/heute nicht auf den heutigen Tag begrenzt: hier steht, was
 * ansteht und was gerade läuft. Sortiert nach Termin, offene ohne Termin
 * ganz unten — sie sind noch nicht zugesagt.
 *
 * Abgeschlossene Aufträge bleiben draußen. Wer sie sucht, sucht ein Dokument,
 * und dafür ist das Backoffice zuständig.
 */
export default async function MobileAuftraegePage() {
  await requireMe();
  const supabase = await createClient();
  const heute = viennaDay();

  const { data: jobs } = await supabase
    .from("job")
    .select(
      "id, number, address, zip, city, next_step, scheduled_from, planned_hours, phase:phase_id ( label, system_key ), customer:customer_id ( name )",
    )
    .order("scheduled_from", { ascending: true, nullsFirst: false })
    .limit(80);

  type Zeile = {
    id: string;
    number: string;
    address: string | null;
    zip: string | null;
    city: string | null;
    next_step: string | null;
    scheduled_from: string | null;
    planned_hours: string;
    phase: { label: string; system_key: string | null } | null;
    customer: { name: string } | null;
  };

  const alle = (jobs ?? []) as unknown as Zeile[];
  const offen = alle.filter((j) => j.phase?.system_key !== "closed");

  const laufend = offen.filter(
    (j) => j.scheduled_from && j.scheduled_from.slice(0, 10) <= heute,
  );
  const kommend = offen.filter(
    (j) => j.scheduled_from && j.scheduled_from.slice(0, 10) > heute,
  );
  const ohneTermin = offen.filter((j) => !j.scheduled_from);

  return (
    <>
      <h1 className="mb-1 text-[24px] font-bold tracking-[-0.02em]">Aufträge</h1>
      <p className="mb-4 text-[13px] text-muted">
        {offen.length} offen · nach Termin sortiert
      </p>

      <Gruppe titel="Läuft" jobs={laufend} />
      <Gruppe titel="Kommt" jobs={kommend} />
      <Gruppe titel="Ohne Termin" jobs={ohneTermin} />

      {offen.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
          Kein offener Auftrag.
        </p>
      ) : null}
    </>
  );
}

function Gruppe({
  titel,
  jobs,
}: {
  titel: string;
  jobs: {
    id: string;
    number: string;
    address: string | null;
    zip: string | null;
    city: string | null;
    next_step: string | null;
    scheduled_from: string | null;
    phase: { label: string; system_key: string | null } | null;
    customer: { name: string } | null;
  }[];
}) {
  if (jobs.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
        {titel}
        <span className="num rounded-pill bg-sunk px-[8px] py-[2px] text-[11px] font-normal text-muted">
          {jobs.length}
        </span>
      </h2>

      <ul className="flex flex-col gap-3">
        {jobs.map((j) => (
          <li key={j.id}>
            <Link
              href={`/m/auftrag/${j.id}`}
              className="block min-h-[56px] rounded-[20px] bg-surface p-[18px] text-ink shadow-soft"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-[12.5px] font-semibold">{j.number}</span>
                {j.phase ? <Pill tone="doing">{j.phase.label}</Pill> : null}
                {j.scheduled_from ? (
                  <span className="num ml-auto text-[11.5px] text-faint">
                    {dateShort(j.scheduled_from)}
                  </span>
                ) : null}
              </div>

              <p className="mt-[6px] text-[16px] leading-snug font-semibold">
                {j.customer?.name ?? "—"}
              </p>
              <p className="text-[13px] text-muted">
                {[j.address, [j.zip, j.city].filter(Boolean).join(" ")]
                  .filter(Boolean)
                  .join(", ") || "keine Adresse hinterlegt"}
              </p>
              {j.next_step ? (
                <p className="mt-2 text-[13px]">{j.next_step}</p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
