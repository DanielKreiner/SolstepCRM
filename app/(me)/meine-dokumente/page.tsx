import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { date, dateTime } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { SignForm } from "@/app/(app)/mitarbeiter/PersonalForms";

export const metadata: Metadata = { title: "Meine Dokumente" };

const DOK_LABEL: Record<string, string> = {
  contract: "Vertrag",
  payslip: "Lohnzettel",
  certificate: "Zertifikat",
  other: "Sonstiges",
};

export default async function MeineDokumentePage() {
  const me = await requireMe();
  const supabase = await createClient();

  const [{ data: dokumente }, { data: quali }] = await Promise.all([
    supabase
      .from("job_document")
      .select("id, kind, filename, size_bytes, signature_status, signed_at, created_at")
      .eq("user_id", me.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("qualification")
      .select("id, name, issued_on, valid_until")
      .eq("user_id", me.id)
      .order("valid_until", { nullsFirst: false }),
  ]);

  const offen = (dokumente ?? []).filter(
    (d) => d.signature_status === "pending",
  );
  const heute = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Meine Dokumente"
        subtitle="Verträge, Lohnzettel und Nachweise — nur die eigenen"
      />

      <div className="mb-4 grid grid-cols-2 gap-[10px] lg:grid-cols-4">
        <Stat label="Dokumente" value={(dokumente ?? []).length} />
        <Stat
          label="Unterschrift offen"
          value={offen.length}
          tone={offen.length > 0 ? "warn" : "done"}
        />
        <Stat label="Nachweise" value={(quali ?? []).length} />
        <Stat
          label="Abgelaufen"
          value={
            (quali ?? []).filter(
              (q) => q.valid_until && (q.valid_until as string) < heute,
            ).length
          }
          tone={
            (quali ?? []).some(
              (q) => q.valid_until && (q.valid_until as string) < heute,
            )
              ? "crit"
              : "done"
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr] xl:items-start">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Dokumente</h2>

          {(dokumente ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">
              Für dich ist noch nichts abgelegt.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(dokumente ?? []).map((d) => (
                <li
                  key={d.id as string}
                  className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                >
                  <Pill tone="neutral">
                    {DOK_LABEL[d.kind as string] ?? (d.kind as string)}
                  </Pill>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {d.filename as string}
                  </span>
                  <span className="num text-[11.5px] text-faint">
                    {dateTime(d.created_at as string)}
                  </span>
                  {d.signature_status === "signed" ? (
                    <Pill tone="done">
                      unterschrieben {date(d.signed_at as string)}
                    </Pill>
                  ) : d.signature_status === "pending" ? (
                    <SignForm
                      documentId={d.id as string}
                      filename={d.filename as string}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">Meine Nachweise</h2>

          {(quali ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">Kein Nachweis hinterlegt.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(quali ?? []).map((q) => {
                const bis = q.valid_until as string | null;
                const abgelaufen = bis !== null && bis < heute;
                return (
                  <li
                    key={q.id as string}
                    className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                  >
                    <span className="min-w-0 flex-1 text-[13px]">
                      {q.name as string}
                    </span>
                    {bis ? (
                      <Pill tone={abgelaufen ? "crit" : "done"}>
                        {abgelaufen ? "abgelaufen" : `bis ${date(bis)}`}
                      </Pill>
                    ) : (
                      <Pill tone="neutral">unbefristet</Pill>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
