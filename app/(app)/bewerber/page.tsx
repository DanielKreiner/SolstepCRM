import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { date } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { AddApplicantForm, StageSelect } from "./ApplicantForms";
import { STUFEN, STUFE_LABEL } from "@/lib/applicants";

export const metadata: Metadata = { title: "Bewerber" };

const TON: Record<string, "new" | "doing" | "waiting" | "done" | "crit"> = {
  neu: "new",
  sichtung: "new",
  telefonat: "doing",
  gespraech: "doing",
  probearbeit: "waiting",
  zusage: "done",
  abgelehnt: "crit",
};

export default async function BewerberPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const { data: bewerber } = await supabase
    .from("applicant")
    .select("id, name, position, email, phone, stage, rating, next_appointment, created_at")
    .order("created_at", { ascending: false });

  const alle = bewerber ?? [];
  const darfPflegen = me.perms.mitarbeiter === "write";

  const proStufe = new Map<string, typeof alle>();
  for (const s of STUFEN) proStufe.set(s, []);
  for (const b of alle) proStufe.get(b.stage as string)?.push(b);

  const laufend = alle.filter(
    (b) => b.stage !== "zusage" && b.stage !== "abgelehnt",
  );

  return (
    <>
      <PageHeader
        title="Bewerber"
        subtitle={`${laufend.length} im Verfahren · ${alle.length} insgesamt`}
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Im Verfahren"
          wert={laufend.length}
          pille={`${new Set(laufend.map((b) => b.position)).size} Positionen`}
          notiz="von Neu bis Probearbeit"
        />
        <KpiKarte
          label="Zusagen"
          wert={proStufe.get("zusage")?.length ?? 0}
          ton="gut"
          notiz="Vertrag folgt"
        />
        <KpiKarte
          label="Abgelehnt"
          wert={proStufe.get("abgelehnt")?.length ?? 0}
          notiz="Daten werden nach sechs Monaten gelöscht"
        />
        <KpiKarte
          label="Offene Positionen"
          wert={new Set(laufend.map((b) => b.position)).size}
          notiz="Stellen mit laufenden Bewerbungen"
        />
      </div>

      {darfPflegen ? (
        <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Bewerber aufnehmen</h2>
          <AddApplicantForm />
        </section>
      ) : (
        <p className="mb-4 rounded-input bg-panel px-4 py-3 text-[13px] text-muted">
          Du kannst die Bewerber sehen, aber nicht ändern.
        </p>
      )}

      <div className="flex gap-[14px] overflow-x-auto pb-3">
        {STUFEN.map((stufe) => {
          const liste = proStufe.get(stufe) ?? [];
          return (
            <div key={stufe} className="flex w-[260px] shrink-0 flex-col gap-3">
              <div className="rounded-[18px] bg-surface p-4 shadow-soft">
                <div className="flex items-center gap-2">
                  <Pill tone={TON[stufe] ?? "neutral"}>
                    {STUFE_LABEL[stufe]}
                  </Pill>
                  <span className="num ml-auto text-[11.5px] text-muted">
                    {liste.length}
                  </span>
                </div>
              </div>

              {liste.map((b) => (
                <article
                  key={b.id as string}
                  className="rounded-[18px] bg-surface p-4 shadow-soft"
                >
                  <p className="text-[14.5px] font-semibold tracking-[-0.01em]">
                    {b.name as string}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {b.position as string}
                  </p>
                  {b.email ? (
                    <p className="num mt-1 truncate text-[11.5px] text-faint">
                      {b.email as string}
                    </p>
                  ) : null}
                  <p className="num mt-2 text-[11px] text-faint">
                    seit {date(b.created_at as string)}
                  </p>

                  {darfPflegen ? (
                    <div className="mt-2">
                      <StageSelect
                        applicantId={b.id as string}
                        stage={b.stage as string}
                        name={b.name as string}
                      />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[12px] text-faint">
        Bewerberdaten sind nach sechs Monaten zu löschen — das Löschkonzept
        steht in CLAUDE.md 12.b und ist noch nicht automatisiert.
      </p>
    </>
  );
}
