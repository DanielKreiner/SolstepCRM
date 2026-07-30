import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pill } from "@/components/ui/Pill";
import { date, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Auftrag" };

export default async function MobileJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("job")
    .select(
      `id, number, address, zip, city, next_step, scheduled_from, scheduled_to, planned_hours,
       customer:customer_id ( name, contact_person, phone ),
       phase:phase_id ( label, system_key )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!job) notFound();

  const [{ data: kpi }, { data: checklist }] = await Promise.all([
    supabase.from("v_job_kpi").select("hours_actual").eq("job_id", id).maybeSingle(),
    supabase
      .from("job_checklist_item")
      .select("id, label, done")
      .eq("job_id", id)
      .order("sort"),
  ]);

  const customer = job.customer as unknown as {
    name: string;
    contact_person: string | null;
    phone: string | null;
  } | null;
  const adresse = [job.address, [job.zip, job.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link href="/m/heute" className="text-[13px] text-accent-ink">
          ← Heute
        </Link>
      </div>

      <h1 className="num text-[15px] font-semibold">{job.number as string}</h1>
      <p className="text-[22px] font-bold tracking-[-0.02em]">
        {customer?.name ?? "—"}
      </p>
      {job.phase ? (
        <div className="mt-2">
          <Pill tone="doing">
            {(job.phase as unknown as { label: string }).label}
          </Pill>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3">
        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <p className="text-[12.5px] text-muted">Adresse</p>
          <p className="text-[15px]">{adresse || "—"}</p>
          {adresse ? (
            <a
              href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(adresse)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[13px] text-accent-ink"
            >
              Auf der Karte öffnen
            </a>
          ) : null}
        </div>

        {customer?.phone ? (
          <a
            href={`tel:${customer.phone}`}
            className="flex min-h-[56px] items-center justify-center rounded-input bg-surface text-[15px] font-medium text-ink shadow-soft"
          >
            {customer.contact_person ?? customer.name} anrufen
          </a>
        ) : null}

        <div className="rounded-[20px] bg-surface p-5 shadow-soft">
          <p className="text-[12.5px] text-muted">Stunden</p>
          <p className="num text-[22px] font-semibold">
            {num(Math.round(Number(kpi?.hours_actual ?? 0) * 10) / 10)} /{" "}
            {num(job.planned_hours as string)}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            Termin {date(job.scheduled_from as string | null)}
          </p>
        </div>

        {(checklist ?? []).length > 0 ? (
          <div className="rounded-[20px] bg-surface p-5 shadow-soft">
            <p className="mb-2 text-[12.5px] text-muted">Aufgaben</p>
            <ul className="flex flex-col gap-2">
              {(checklist ?? []).map((c) => (
                <li
                  key={c.id as string}
                  className="flex items-center gap-3 text-[14px]"
                >
                  <span
                    aria-hidden
                    className={`h-4 w-4 shrink-0 rounded-[5px] border ${c.done ? "border-s-done bg-s-done" : "border-line"}`}
                  />
                  <span className={c.done ? "text-muted line-through" : ""}>
                    {c.label as string}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {job.next_step ? (
          <div className="rounded-[20px] bg-surface p-5 shadow-soft">
            <p className="text-[12.5px] text-muted">Nächster Schritt</p>
            <p className="text-[15px]">{job.next_step as string}</p>
          </div>
        ) : null}

        <Link
          href="/m/material"
          className="flex min-h-[56px] items-center justify-center rounded-input bg-surface text-[15px] font-medium text-ink shadow-soft"
        >
          Material buchen
        </Link>
      </div>
    </>
  );
}
