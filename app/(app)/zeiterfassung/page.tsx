import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { hhmm, hhmmSigned, time, viennaDay } from "@/lib/format";
import { addDays, endOfViennaDay, startOfViennaDay } from "@/lib/time";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { BookingForm } from "./BookingForm";
import { deleteTimeEntry } from "./actions";

export const metadata: Metadata = { title: "Zeiterfassung" };

const KIND_LABEL: Record<string, string> = {
  work: "Arbeit",
  travel: "Fahrt",
  break: "Pause",
  errand: "Besorgung",
  training: "Schulung",
  leave_comp: "Zeitausgleich",
};

type Entry = {
  id: string;
  user_id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  status: string;
  note: string | null;
  job: { id: string; number: string } | null;
  person: { id: string; name: string } | null;
};

export default async function ZeiterfassungPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();

  const { tag } = await searchParams;
  const day = tag && /^\d{4}-\d{2}-\d{2}$/.test(tag) ? tag : viennaDay();

  const canSeeAll = me.perms.zeiterfassung === "write" || me.perms.zeiterfassung === "read";

  const [{ data: entries }, { data: jobs }, { data: users }] = await Promise.all([
    supabase
      .from("time_entry")
      .select(
        `id, user_id, kind, started_at, ended_at, duration_min, status, note,
         job:job_id ( id, number ),
         person:user_id ( id, name )`,
      )
      .gte("started_at", startOfViennaDay(day).toISOString())
      .lt("started_at", endOfViennaDay(day).toISOString())
      .order("started_at"),
    supabase
      .from("job")
      .select("id, number, customer:customer_id ( name )")
      .order("number", { ascending: false })
      .limit(100),
    canSeeAll
      ? supabase.from("app_user").select("id, name").eq("active", true).order("name")
      : Promise.resolve({ data: [{ id: me.id, name: me.name }] }),
  ]);

  const rows = (entries ?? []) as unknown as Entry[];

  const gebucht = rows
    .filter((r) => r.kind !== "break")
    .reduce((s, r) => s + (r.duration_min ?? 0), 0);
  const pause = rows
    .filter((r) => r.kind === "break")
    .reduce((s, r) => s + (r.duration_min ?? 0), 0);
  const soll = Math.round((me.weeklyHours / 5) * 60);

  const columns: Column<Entry>[] = [
    {
      key: "person",
      header: "Person",
      width: "1.2fr",
      render: (e) => (
        <span className="text-sm font-medium">{e.person?.name ?? "—"}</span>
      ),
    },
    {
      key: "zeit",
      header: "Von – bis",
      width: "150px",
      render: (e) => (
        <span className="num text-[13px]">
          {time(e.started_at)} – {e.ended_at ? time(e.ended_at) : "läuft"}
        </span>
      ),
    },
    {
      key: "dauer",
      header: "Dauer",
      width: "90px",
      align: "right",
      render: (e) => (
        <span className="num text-[13px] font-semibold">
          {hhmm(e.duration_min)}
        </span>
      ),
    },
    {
      key: "art",
      header: "Art",
      width: "130px",
      render: (e) => (
        <Pill tone={e.kind === "break" ? "neutral" : "doing"}>
          {KIND_LABEL[e.kind] ?? e.kind}
        </Pill>
      ),
    },
    {
      key: "auftrag",
      header: "Auftrag",
      width: "140px",
      render: (e) =>
        e.job ? (
          <Link
            href={`/auftraege/${e.job.id}`}
            className="num text-[12.5px] text-accent-ink hover:underline"
          >
            {e.job.number}
          </Link>
        ) : (
          <span className="text-[12.5px] text-faint">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      render: (e) => (
        <Pill
          tone={
            e.status === "approved"
              ? "done"
              : e.status === "flagged"
                ? "crit"
                : e.status === "running"
                  ? "doing"
                  : "neutral"
          }
        >
          {e.status === "booked"
            ? "gebucht"
            : e.status === "approved"
              ? "genehmigt"
              : e.status === "flagged"
                ? "geprüft"
                : e.status === "running"
                  ? "läuft"
                  : "ersetzt"}
        </Pill>
      ),
    },
    {
      key: "aktion",
      header: "",
      width: "110px",
      align: "right",
      render: (e) =>
        e.user_id === me.id && e.status === "booked" ? (
          <form action={deleteTimeEntry}>
            <input type="hidden" name="id" value={e.id} />
            <button
              type="submit"
              className="cursor-pointer rounded-pill border-0 bg-transparent px-2 py-1 text-[12.5px] text-muted hover:text-s-crit"
            >
              löschen
            </button>
          </form>
        ) : null,
    },
  ];

  const jobOptions = (jobs ?? []).map((j) => ({
    id: j.id as string,
    label: `${j.number as string} · ${(j.customer as unknown as { name: string } | null)?.name ?? ""}`,
  }));

  const userOptions = (users ?? []).map((u) => ({
    id: u.id as string,
    label: u.name as string,
  }));

  return (
    <>
      <PageHeader
        title="Zeiterfassung"
        subtitle={`Tagesansicht · ${new Date(`${day}T12:00:00Z`).toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}`}
        actions={
          <div className="flex items-center gap-1 rounded-pill bg-surface p-1 shadow-soft">
            <DayLink day={addDays(day, -1)} label="‹" />
            <DayLink day={viennaDay()} label="Heute" />
            <DayLink day={addDays(day, 1)} label="›" />
          </div>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Gebucht heute"
          wert={hhmm(gebucht)}
          pille={hhmmSigned(gebucht - soll)}
          notiz={`Tagessoll ${hhmm(soll)}`}
        />
        <KpiKarte label="Pause" wert={hhmm(pause)} notiz="nicht als Arbeitszeit gezählt" />
        <KpiKarte label="Tagessoll" wert={hhmm(soll)} notiz="aus den Wochenstunden gerechnet" />
        <KpiKarte
          label="Differenz"
          wert={hhmmSigned(gebucht - soll)}
          ton={gebucht - soll < 0 ? "warn" : "gut"}
          notiz={gebucht - soll < 0 ? "unter Soll" : "über Soll"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(e) => e.id}
          empty="Für diesen Tag ist nichts gebucht."
          compact
        />
        <BookingForm
          day={day}
          jobs={jobOptions}
          users={userOptions}
          meId={me.id}
          canBookOthers={me.perms.zeiterfassung === "write"}
        />
      </div>
    </>
  );
}

function DayLink({ day, label }: { day: string; label: string }) {
  return (
    <Link
      href={`/zeiterfassung?tag=${day}`}
      className="rounded-pill px-[15px] py-[9px] text-[13.5px] text-muted transition-colors hover:text-ink"
    >
      {label}
    </Link>
  );
}
