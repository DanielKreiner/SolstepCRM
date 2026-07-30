import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, hhmm, initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/nav";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mitarbeiter" };

type Row = {
  id: string;
  name: string;
  email: string;
  role: string;
  weekly_hours: string;
  employment_type: string;
  active: boolean;
  location: { name: string } | null;
};

export default async function MitarbeiterPage() {
  await requireMe();
  const supabase = await createClient();

  const [{ data: users }, { data: qualifikationen }, { data: salden }] =
    await Promise.all([
      supabase
        .from("app_user")
        .select(
          "id, name, email, role, weekly_hours, employment_type, active, location:location_id ( name )",
        )
        .order("active", { ascending: false })
        .order("name"),
      supabase.from("qualification").select("user_id, name, valid_until"),
      supabase.from("v_time_balance").select("user_id, actual_min, adjust_min"),
    ]);

  const rows = (users ?? []) as unknown as Row[];
  const heute = new Date().toISOString().slice(0, 10);
  const inSechzig = new Date();
  inSechzig.setDate(inSechzig.getDate() + 60);

  const ablaufend = new Map<string, { name: string; bis: string }[]>();
  for (const q of qualifikationen ?? []) {
    const bis = q.valid_until as string | null;
    if (!bis || bis > inSechzig.toISOString().slice(0, 10)) continue;
    const key = q.user_id as string;
    if (!ablaufend.has(key)) ablaufend.set(key, []);
    ablaufend.get(key)!.push({ name: q.name as string, bis });
  }

  const saldoMap = new Map(
    (salden ?? []).map((s) => [
      s.user_id as string,
      Number(s.actual_min ?? 0) + Number(s.adjust_min ?? 0),
    ]),
  );

  const abgelaufen = [...ablaufend.values()]
    .flat()
    .filter((q) => q.bis < heute).length;

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      width: "1.6fr",
      render: (u) => (
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`flex h-8 w-8 items-center justify-center rounded-pill text-[11px] font-semibold text-white ${u.active ? "bg-s-doing" : "bg-s-new"}`}
          >
            {initials(u.name)}
          </span>
          <span>
            <span className="block text-sm font-medium">{u.name}</span>
            <span className="num block text-[11.5px] text-muted">{u.email}</span>
          </span>
        </div>
      ),
    },
    {
      key: "rolle",
      header: "Rolle",
      width: "160px",
      render: (u) => (
        <Pill tone={u.active ? "doing" : "neutral"}>
          {ROLE_LABEL[u.role] ?? u.role}
        </Pill>
      ),
    },
    {
      key: "standort",
      header: "Standort",
      width: "130px",
      render: (u) => (
        <span className="text-[13px]">{u.location?.name ?? "—"}</span>
      ),
    },
    {
      key: "stunden",
      header: "Wochenstunden",
      width: "140px",
      align: "right",
      render: (u) => (
        <span className="num text-[12.5px]">{u.weekly_hours} h</span>
      ),
    },
    {
      key: "saldo",
      header: "Iststunden",
      width: "120px",
      align: "right",
      render: (u) => (
        <span className="num text-[13px] font-semibold">
          {hhmm(saldoMap.get(u.id) ?? 0)}
        </span>
      ),
    },
    {
      key: "quali",
      header: "Nachweise",
      width: "190px",
      render: (u) => {
        const eigene = ablaufend.get(u.id) ?? [];
        if (eigene.length === 0)
          return <span className="text-[12.5px] text-faint">—</span>;
        const kritisch = eigene.filter((q) => q.bis < heute).length;
        return (
          <Pill tone={kritisch > 0 ? "crit" : "warn"}>
            {kritisch > 0
              ? `${kritisch} abgelaufen`
              : `${eigene.length} läuft ab`}
          </Pill>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Mitarbeiter"
        subtitle={`${rows.filter((u) => u.active).length} aktiv · Nachweise mit 60 Tagen Vorwarnung`}
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Aktiv" value={rows.filter((u) => u.active).length} />
        <Stat
          label="Nachweise laufen ab"
          value={[...ablaufend.values()].flat().length}
          tone={ablaufend.size > 0 ? "warn" : "done"}
        />
        <Stat
          label="Abgelaufen"
          value={abgelaufen}
          tone={abgelaufen > 0 ? "crit" : "done"}
        />
        <Stat
          label="Standorte"
          value={new Set(rows.map((u) => u.location?.name).filter(Boolean)).size}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(u) => u.id}
        hrefFor={(u) => `/mitarbeiter/${u.id}`}
        empty="Noch keine Mitarbeiter angelegt."
      />

      <p className="mt-3 text-[12px] text-faint">
        Stand {date(heute)}. Ein abgelaufener Nachweis ist kein Formfehler —
        ohne gültige Unterweisung darf niemand aufs Dach.
      </p>
    </>
  );
}
