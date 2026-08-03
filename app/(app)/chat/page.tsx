import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { dateTime, initials } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ChannelForm, MessageForm } from "./ChatForms";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ kanal?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();
  const { kanal } = await searchParams;

  const [{ data: kanaele }, { data: jobs }] = await Promise.all([
    supabase
      .from("chat_channel")
      .select("id, name, kind, vorgang:vorgang_id ( id, number )")
      .order("name"),
    supabase
      .from("vorgang")
      .select("id, number, customer:customer_id ( name )")
      .order("number", { ascending: false })
      .limit(50),
  ]);

  const aktiv =
    (kanaele ?? []).find((k) => k.id === kanal) ?? (kanaele ?? [])[0] ?? null;

  const { data: nachrichten } = aktiv
    ? await supabase
        .from("chat_message")
        .select("id, body, created_at, system_kind, person:user_id ( id, name )")
        .eq("channel_id", aktiv.id)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] };

  return (
    <>
      <PageHeader
        title="Chat"
        subtitle="Teamkanäle und auftragsbezogene Kanäle"
      />

      <div className="grid gap-4 xl:grid-cols-[280px_1fr] xl:items-start">
        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          <h2 className="mb-3 text-[15px] font-semibold">
            Kanäle{" "}
            <span className="num font-normal text-muted">
              ({(kanaele ?? []).length})
            </span>
          </h2>

          {(kanaele ?? []).length === 0 ? (
            <p className="mb-3 text-[13px] text-muted">Noch kein Kanal.</p>
          ) : (
            <ul className="mb-4 flex flex-col gap-1">
              {(kanaele ?? []).map((k) => {
                const job = k.vorgang as unknown as {
                  id: string;
                  number: string;
                } | null;
                const gewaehlt = aktiv?.id === k.id;
                return (
                  <li key={k.id as string}>
                    <Link
                      href={`/chat?kanal=${k.id as string}`}
                      className={[
                        "flex items-center gap-2 rounded-input px-3 py-[9px] text-[13px] text-ink transition-colors",
                        gewaehlt ? "bg-sunk font-semibold" : "hover:bg-panel",
                      ].join(" ")}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {k.name as string}
                      </span>
                      {job ? (
                        <span className="num text-[10.5px] text-faint">
                          {job.number}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-line pt-3">
            <ChannelForm
              jobs={(jobs ?? []).map((j) => ({
                id: j.id as string,
                label: `${j.number as string} · ${(j.customer as unknown as { name: string } | null)?.name ?? ""}`,
              }))}
            />
          </div>
        </section>

        <section className="rounded-[20px] bg-surface p-5 shadow-soft">
          {!aktiv ? (
            <p className="text-[13px] text-muted">
              Lege links einen Kanal an, dann geht es los.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-[15px] font-semibold">
                  {aktiv.name as string}
                </h2>
                <Pill tone={aktiv.kind === "job" ? "doing" : "neutral"}>
                  {aktiv.kind === "job" ? "Auftrag" : "Team"}
                </Pill>
                <span className="num text-[12px] text-muted">
                  {(nachrichten ?? []).length} Nachrichten
                </span>
              </div>

              <MessageForm channelId={aktiv.id as string} />

              {(nachrichten ?? []).length === 0 ? (
                <p className="mt-4 text-[13px] text-muted">
                  Noch nichts geschrieben.
                </p>
              ) : (
                <ul className="mt-4 flex flex-col gap-3">
                  {(nachrichten ?? []).map((n) => {
                    const person = n.person as unknown as {
                      id: string;
                      name: string;
                    } | null;
                    const eigen = person?.id === me.id;
                    return (
                      <li key={n.id as string} className="flex gap-3">
                        <span
                          aria-hidden
                          className={[
                            "mt-[2px] flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-[10px] font-semibold text-white",
                            eigen ? "bg-accent" : "bg-s-doing",
                          ].join(" ")}
                        >
                          {person ? initials(person.name) : "··"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-muted">
                            {person?.name ?? "System"}
                            {" · "}
                            <span className="num">
                              {dateTime(n.created_at as string)}
                            </span>
                          </p>
                          <p className="text-[13.5px] whitespace-pre-line">
                            {n.body as string}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
