import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { ROLE_LABEL } from "@/lib/nav";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AddPhaseForm, PermissionCell, PhaseRowForm } from "./SettingsForms";

export const metadata: Metadata = { title: "Einstellungen" };

const AREAS = [
  ["pipelines", "Pipelines"],
  ["angebote", "Angebote"],
  ["crm", "CRM"],
  ["lager", "Lager"],
  ["rechnungen", "Rechnungen"],
  ["zeiterfassung", "Zeiterfassung"],
  ["mitarbeiter", "Mitarbeiter"],
  ["berichte", "Berichte"],
  ["einstellungen", "Einstellungen"],
] as const;

const ROLES = ["gf", "buero", "bauleitung", "monteur", "lager"] as const;

const KIND_LABEL: Record<string, string> = {
  vertrieb: "Vertrieb",
  projekte: "Projekte",
  service: "Service",
};

export default async function EinstellungenPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const darfSchreiben = me.perms.einstellungen === "write";

  const [{ data: perms }, { data: pipelines }, { data: company }, belegung] =
    await Promise.all([
      supabase.from("role_permission").select("role, area, level"),
      supabase
        .from("pipeline")
        .select("id, kind, name, sort, phasen:pipeline_phase ( id, key, label, sort, system_key, is_final )")
        .order("sort"),
      supabase
        .from("company")
        .select("name, uid_nr, address, zip, city, country, iban, status, plan, seats")
        .maybeSingle(),
      phasenBelegung(),
    ]);

  const permMap = new Map<string, string>();
  for (const p of perms ?? []) {
    permMap.set(`${p.role as string}:${p.area as string}`, p.level as string);
  }

  return (
    <>
      <PageHeader
        title="Einstellungen"
        subtitle="Rollenrechte und Phasen je Mandant. Beides wirkt serverseitig."
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Mandant" value={(company?.name as string) ?? "—"} />
        <Stat
          label="Status"
          value={
            <Pill tone={company?.status === "active" ? "done" : "warn"}>
              {(company?.status as string) ?? "—"}
            </Pill>
          }
        />
        <Stat label="Plan" value={(company?.plan as string) ?? "—"} />
        <Stat label="Plätze" value={(company?.seats as number) ?? 0} />
      </div>

      {!darfSchreiben ? (
        <p className="mb-4 rounded-input bg-panel px-4 py-3 text-[13px] text-muted">
          Du kannst die Einstellungen sehen, aber nicht ändern.
        </p>
      ) : null}

      <section className="mb-6 overflow-x-auto rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">Rollenmatrix</h2>
        <p className="mt-1 mb-3 text-[12.5px] text-muted">
          Durchgesetzt wird das in der Datenbank über <span className="num">can()</span>.
          Die Navigation blendet nur zusätzlich aus.
        </p>

        <div className="min-w-[860px]">
          <div
            className="grid border-b border-line text-[11px] tracking-[0.07em] text-faint uppercase"
            style={{ gridTemplateColumns: `180px repeat(${ROLES.length}, 1fr)` }}
          >
            <div className="px-[6px] py-[14px]">Bereich</div>
            {ROLES.map((r) => (
              <div key={r} className="px-[6px] py-[14px]">
                {ROLE_LABEL[r] ?? r}
              </div>
            ))}
          </div>

          {AREAS.map(([area, label]) => (
            <div
              key={area}
              className="grid items-center border-b border-line last:border-b-0"
              style={{ gridTemplateColumns: `180px repeat(${ROLES.length}, 1fr)` }}
            >
              <div className="px-[6px] py-2 text-[13px] font-medium">{label}</div>
              {ROLES.map((role) => (
                <PermissionCell
                  key={`${role}-${area}`}
                  role={role}
                  area={area}
                  level={permMap.get(`${role}:${area}`) ?? "none"}
                  gesperrt={
                    !darfSchreiben ||
                    (role === "gf" && area === "einstellungen")
                  }
                />
              ))}
            </div>
          ))}
        </div>

        <p className="mt-3 text-[12px] text-faint">
          Das Recht der Geschäftsführung auf Einstellungen ist gesperrt — sonst
          sperrt sich der Betrieb mit einem Klick aus seiner eigenen
          Rechteverwaltung aus.
        </p>
      </section>

      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold">Phasen</h2>
        <p className="mt-1 mb-4 text-[12.5px] text-muted">
          Jeder Betrieb arbeitet anders. Phasen mit Systembedeutung tragen
          Automatiken und lassen sich umbenennen, aber nicht löschen.
        </p>

        <div className="flex flex-col gap-6">
          {(pipelines ?? []).map((p) => {
            const phasen = ((p.phasen ?? []) as unknown as {
              id: string;
              key: string;
              label: string;
              sort: number;
              system_key: string | null;
              is_final: boolean;
            }[]).sort((a, b) => a.sort - b.sort);

            const naechste =
              Math.max(0, ...phasen.map((ph) => ph.sort)) + 1;

            return (
              <div key={p.id as string}>
                <h3 className="mb-2 text-[13.5px] font-semibold">
                  {KIND_LABEL[p.kind as string] ?? (p.name as string)}
                </h3>

                <ul className="flex flex-col gap-2">
                  {phasen.map((ph) => (
                    <li
                      key={ph.id}
                      className="rounded-input bg-panel px-4 py-3"
                    >
                      {darfSchreiben ? (
                        <PhaseRowForm
                          phaseId={ph.id}
                          label={ph.label}
                          systemKey={ph.system_key}
                          belegt={belegung.get(ph.id) ?? 0}
                        />
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className="text-[13px]">{ph.label}</span>
                          {ph.system_key ? (
                            <span className="num rounded-pill bg-s-warn/12 px-[9px] py-[3px] text-[11px] text-accent-ink">
                              {ph.system_key}
                            </span>
                          ) : null}
                          <span className="num text-[11.5px] text-faint">
                            {belegung.get(ph.id) ?? 0} Einträge
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {darfSchreiben ? (
                  <AddPhaseForm
                    pipelineId={p.id as string}
                    naechsteSortierung={naechste}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

/** Wie viele Einträge hängen an welcher Phase — für die Löschsperre. */
async function phasenBelegung(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const [jobs, quotes, tickets] = await Promise.all([
    supabase.from("job").select("phase_id"),
    supabase.from("quote").select("phase_id"),
    supabase.from("service_ticket").select("phase_id"),
  ]);

  const map = new Map<string, number>();
  for (const liste of [jobs.data, quotes.data, tickets.data]) {
    for (const r of liste ?? []) {
      const id = r.phase_id as string | null;
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
  }
  return map;
}
