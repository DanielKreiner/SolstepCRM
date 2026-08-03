import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill, type Tone } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { dateTime } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { TicketAnlegen } from "./ServiceForms";

export const metadata: Metadata = { title: "Service" };

const KATEGORIE: Record<string, string> = {
  stoerung: "Störung",
  frage: "Frage",
  beschwerde: "Beschwerde",
  rechnung: "Rechnung",
};

const QUELLE: Record<string, string> = {
  portal: "Kundenportal",
  phone: "Telefon",
  mail: "E-Mail",
};

const STATUS: Record<string, { label: string; ton: Tone }> =
  {
    offen: { label: "offen", ton: "new" },
    diagnose: { label: "in Prüfung", ton: "doing" },
    termin_geplant: { label: "Termin geplant", ton: "waiting" },
    behoben: { label: "erledigt", ton: "done" },
  };

/**
 * Alle Anliegen an einem Ort.
 *
 * Diese Liste hat gefehlt: Meldungen aus dem Kundenportal lagen in der
 * Datenbank, waren aber nirgends im Backoffice zu sehen. Wer im Büro
 * sitzt, hatte keine Möglichkeit zu merken, dass ein Kunde etwas gefragt
 * hat — geschweige denn zu antworten.
 */
export default async function ServicePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await requireMe();
  const { status: filter = "aktiv" } = await searchParams;
  const supabase = await createClient();

  const [{ data: tickets }, { data: kunden }] = await Promise.all([
    supabase
      .from("service_ticket")
      .select(
        `id, number, category, source, severity, status, body, created_at,
         customer:customer_id ( id, name ),
         assignee:assignee_id ( name )`,
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("customer")
      .select("id, name, city")
      .is("deleted_at", null)
      .order("name"),
  ]);

  const alle = (tickets ?? []) as unknown as {
    id: string;
    number: string;
    category: string;
    source: string;
    severity: number;
    status: string;
    body: string;
    created_at: string;
    customer: { id: string; name: string } | null;
    assignee: { name: string } | null;
  }[];

  /*
   * Welche Tickets warten auf eine Antwort? Nicht der Status entscheidet
   * das, sondern ob die letzte Nachricht vom Kunden kam. Ein Ticket in
   * „in Prüfung", auf das der Kunde nachgefragt hat, ist offen — auch
   * wenn niemand den Status zurückgesetzt hat.
   */
  const { data: nachrichten } = await supabase
    .from("service_message")
    .select("ticket_id, author, internal, created_at")
    .in("ticket_id", alle.map((t) => t.id).slice(0, 200))
    .order("created_at");

  const letzterAutor = new Map<string, string>();
  for (const m of (nachrichten ?? []) as unknown as {
    ticket_id: string;
    author: string;
    internal: boolean;
  }[]) {
    if (m.internal) continue;
    letzterAutor.set(m.ticket_id, m.author);
  }

  const wartet = (t: { id: string; status: string }) =>
    t.status !== "behoben" && (letzterAutor.get(t.id) ?? "kunde") === "kunde";

  const gefiltert =
    filter === "alle"
      ? alle
      : filter === "wartend"
        ? alle.filter(wartet)
        : alle.filter((t) => t.status !== "behoben");

  const offen = alle.filter((t) => t.status !== "behoben").length;
  const wartend = alle.filter(wartet).length;
  const dringend = alle.filter(
    (t) => t.status !== "behoben" && Number(t.severity) === 1,
  ).length;

  const darfSchreiben = me.perms.pipelines === "write";

  return (
    <>
      <PageHeader
        title="Service"
        subtitle="Anliegen aus dem Kundenportal, per Telefon und per Mail"
        actions={
          darfSchreiben ? (
            <TicketAnlegen
              kunden={(kunden ?? []).map((k) => ({
                wert: k.id as string,
                text: k.name as string,
                ...(k.city ? { zusatz: k.city as string } : {}),
              }))}
            />
          ) : null
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-3">
        <Stat label="Offen" value={String(offen)} />
        <Stat
          label="Wartet auf Antwort"
          value={
            wartend > 0 ? (
              <span className="text-s-warn">{wartend}</span>
            ) : (
              String(wartend)
            )
          }
        />
        <Stat
          label="Dringend"
          value={
            dringend > 0 ? (
              <span className="text-s-crit">{dringend}</span>
            ) : (
              String(dringend)
            )
          }
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ["aktiv", "Aktiv"],
          ["wartend", "Wartet auf uns"],
          ["alle", "Alle"],
        ].map(([wert, label]) => (
          <Link
            key={wert}
            href={`/service?status=${wert}`}
            className={[
              "rounded-pill px-4 py-[9px] text-[12.5px] font-medium",
              filter === wert
                ? "bg-ink text-app hover:text-app"
                : "border border-line bg-surface text-ink hover:bg-sunk hover:text-ink",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
      </div>

      {gefiltert.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
          Kein Anliegen in dieser Auswahl.
        </p>
      ) : (
        <ul className="flex flex-col gap-[10px]">
          {gefiltert.map((t) => {
            const s = STATUS[t.status] ?? { label: t.status, ton: "new" as const };
            return (
              <li key={t.id}>
                <Link
                  href={`/service/${t.id}`}
                  className="block rounded-[20px] bg-surface p-5 shadow-soft transition-colors hover:bg-panel"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-[13px] font-semibold">
                      {t.number}
                    </span>
                    <Pill tone={s.ton}>{s.label}</Pill>
                    {wartet(t) ? (
                      <Pill tone="warn">wartet auf Antwort</Pill>
                    ) : null}
                    {Number(t.severity) === 1 ? (
                      <Pill tone="crit">dringend</Pill>
                    ) : null}
                    <span className="text-[12px] text-muted">
                      {KATEGORIE[t.category] ?? t.category} ·{" "}
                      {QUELLE[t.source] ?? t.source}
                    </span>
                    <span className="num ml-auto text-[11.5px] text-faint">
                      {dateTime(t.created_at)}
                    </span>
                  </div>

                  <p className="mt-2 text-[14px] font-medium">
                    {t.customer?.name ?? "—"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-[1.5] text-muted">
                    {t.body}
                  </p>
                  {t.assignee ? (
                    <p className="mt-2 text-[11.5px] text-faint">
                      Zuständig: {t.assignee.name}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
