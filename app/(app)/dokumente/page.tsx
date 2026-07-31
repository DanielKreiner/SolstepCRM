import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { dateTime } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dokumente" };

const KIND_LABEL: Record<string, string> = {
  quote: "Angebot",
  delivery_note: "Lieferschein",
  photo: "Foto",
  handover: "Übergabe",
  invoice: "Rechnung",
  grid: "Netzanmeldung",
  contract: "Vertrag",
  payslip: "Lohnzettel",
  certificate: "Zertifikat",
  other: "Sonstiges",
};

const PERSONAL = new Set(["contract", "payslip", "certificate"]);

export default async function DokumentePage() {
  const me = await requireMe();
  const supabase = await createClient();

  const { data: dokumente } = await supabase
    .from("job_document")
    .select(
      `id, kind, filename, size_bytes, signature_status, signed_at, created_at,
       visible_to_customer, user_id,
       job:job_id ( id, number ),
       customer:customer_id ( id, name ),
       person:user_id ( name )`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const alle = dokumente ?? [];
  const personal = alle.filter((d) => d.user_id !== null);
  const baustelle = alle.filter((d) => d.user_id === null);
  const offen = alle.filter((d) => d.signature_status === "pending").length;

  return (
    <>
      <PageHeader
        title="Dokumente"
        subtitle="Was du hier siehst, hängt an deinen Rechten"
        actions={
          <Link
            href="/meine-dokumente"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Meine Dokumente
          </Link>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Sichtbare Dokumente"
          wert={alle.length}
          pille={`${baustelle.length} Baustelle`}
          notiz="was deine Rolle sehen darf"
        />
        <KpiKarte
          label="Baustelle und Kunde"
          wert={baustelle.length}
          notiz="Lieferscheine, Fotos, Übergaben"
        />
        <KpiKarte
          label="Personalakte"
          wert={personal.length}
          notiz="Lohnzettel, Verträge, Nachweise"
        />
        <KpiKarte
          label="Unterschrift offen"
          wert={offen}
          pille={offen > 0 ? "erinnern" : "alles unterschrieben"}
          ton={offen > 0 ? "warn" : "gut"}
          notiz="E-Signatur angefordert, noch nicht erledigt"
        />
      </div>

      {alle.length === 0 ? (
        <div className="rounded-[20px] bg-surface p-6 text-[13.5px] text-muted shadow-soft">
          Für dich ist kein Dokument sichtbar.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {alle.map((d) => {
            const job = d.job as unknown as { id: string; number: string } | null;
            const kunde = d.customer as unknown as {
              id: string;
              name: string;
            } | null;
            const person = d.person as unknown as { name: string } | null;
            const istPersonal = PERSONAL.has(d.kind as string);

            return (
              <li
                key={d.id as string}
                className="flex flex-wrap items-center gap-3 rounded-[20px] bg-surface px-5 py-4 shadow-soft"
              >
                <Pill tone={istPersonal ? "waiting" : "neutral"}>
                  {KIND_LABEL[d.kind as string] ?? (d.kind as string)}
                </Pill>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {d.filename as string}
                </span>

                {job ? (
                  <Link
                    href={`/auftraege/${job.id}`}
                    className="num text-[12.5px] text-accent-ink hover:underline"
                  >
                    {job.number}
                  </Link>
                ) : null}
                {kunde ? (
                  <Link
                    href={`/crm/${kunde.id}`}
                    className="text-[12.5px] text-accent-ink hover:underline"
                  >
                    {kunde.name}
                  </Link>
                ) : null}
                {person ? (
                  <span className="text-[12.5px] text-muted">{person.name}</span>
                ) : null}

                {d.visible_to_customer ? (
                  <Pill tone="doing">im Portal sichtbar</Pill>
                ) : null}
                {d.signature_status === "signed" ? (
                  <Pill tone="done">unterschrieben</Pill>
                ) : d.signature_status === "pending" ? (
                  <Pill tone="warn">Unterschrift offen</Pill>
                ) : null}

                <span className="num text-[11.5px] text-faint">
                  {dateTime(d.created_at as string)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[12px] text-faint">
        Personalakten sind nur für die betroffene Person und für Rollen mit
        Leserecht auf Mitarbeiter sichtbar. Durchgesetzt wird das in der
        Datenbank, nicht hier.
        {me.perms.mitarbeiter === "none"
          ? " Deiner Rolle fehlt dieses Recht — fremde Personalakten fehlen in der Liste."
          : ""}
      </p>
    </>
  );
}
