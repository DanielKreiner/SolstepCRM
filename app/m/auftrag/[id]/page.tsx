import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pill } from "@/components/ui/Pill";
import { dateTime, hhmm } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Auftrag" };

const PHASE_LABEL: Record<string, string> = {
  anfrage: "Anfrage",
  aufnahme: "Aufnahme",
  angebot: "Angebot",
  beauftragt: "Beauftragt",
  montage: "Montage",
  abschluss: "Abschluss",
  verloren: "Verloren",
};

const ART: Record<string, string> = {
  aufnahme: "Aufnahme",
  montage: "Montage",
  service: "Service",
};

/*
 * Der Vorgang auf dem Handy.
 *
 * Keine Beträge und keine Soll-Stunden: die liefert die Datenbank dieser
 * Rolle nicht (Spaltenrechte aus 0025, v_vorgang_wert aus 0030). Statt
 * eines Plan/Ist-Vergleichs steht hier, was gebucht ist — das ist die
 * Zahl, die der Monteur selbst beeinflusst.
 */
export default async function MobileVorgangPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMe();
  const { id } = await params;
  const supabase = await createClient();

  const { data: vorgang } = await supabase
    .from("vorgang")
    .select(
      `id, number, phase, adresse, plz, ort, kwp, speicher_kwh,
       customer:customer_id ( name, contact_person, phone )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!vorgang) notFound();

  const [{ data: zeiten }, { data: gates }, { data: termine }] =
    await Promise.all([
      supabase
        .from("time_entry")
        .select("duration_min, kind")
        .eq("vorgang_id", id)
        .in("status", ["booked", "approved"]),
      supabase
        .from("vorgang_gate")
        .select("id, label, status, blocking")
        .eq("vorgang_id", id)
        .order("sort"),
      supabase
        .from("vorgang_termin")
        .select("id, art, von, bis, notiz")
        .eq("vorgang_id", id)
        .order("von"),
    ]);

  const gebucht = (zeiten ?? [])
    .filter((z) => z.kind !== "break")
    .reduce((s, z) => s + Number(z.duration_min ?? 0), 0);

  const customer = vorgang.customer as unknown as {
    name: string;
    contact_person: string | null;
    phone: string | null;
  } | null;

  const adresse = [
    vorgang.adresse as string | null,
    [vorgang.plz, vorgang.ort].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const naechster = (termine ?? [])[0];

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link href="/m/heute" className="text-[13px] text-accent-ink">
          ← Heute
        </Link>
      </div>

      <h1 className="num text-[15px] font-semibold">
        {vorgang.number as string}
      </h1>
      <p className="text-[22px] font-bold tracking-[-0.02em]">
        {customer?.name ?? "—"}
      </p>
      <div className="mt-2">
        <Pill tone="doing">
          {PHASE_LABEL[vorgang.phase as string] ?? (vorgang.phase as string)}
        </Pill>
      </div>

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
          <p className="text-[12.5px] text-muted">Gebucht</p>
          <p className="num text-[22px] font-semibold">{hhmm(gebucht)}</p>
          {naechster ? (
            <p className="mt-1 text-[12px] text-muted">
              {ART[naechster.art as string] ?? (naechster.art as string)}{" "}
              {dateTime(naechster.von as string)}
            </p>
          ) : (
            <p className="mt-1 text-[12px] text-muted">Kein Termin gesetzt</p>
          )}
        </div>

        {vorgang.kwp ? (
          <div className="rounded-[20px] bg-surface p-5 shadow-soft">
            <p className="text-[12.5px] text-muted">Anlage</p>
            <p className="num text-[15px]">
              {vorgang.kwp as string} kWp
              {vorgang.speicher_kwh
                ? ` · ${vorgang.speicher_kwh as string} kWh Speicher`
                : ""}
            </p>
          </div>
        ) : null}

        {(gates ?? []).length > 0 ? (
          <div className="rounded-[20px] bg-surface p-5 shadow-soft">
            <p className="mb-2 text-[12.5px] text-muted">Voraussetzungen</p>
            <ul className="flex flex-col gap-2">
              {(gates ?? []).map((g) => {
                const durch =
                  g.status === "erledigt" || g.status === "nicht_noetig";
                return (
                  <li
                    key={g.id as string}
                    className="flex items-center gap-3 text-[14px]"
                  >
                    <span
                      aria-hidden
                      className={`h-4 w-4 shrink-0 rounded-[5px] border ${durch ? "border-s-done bg-s-done" : "border-line"}`}
                    />
                    <span className={durch ? "text-muted line-through" : ""}>
                      {g.label as string}
                    </span>
                    {!durch && g.blocking ? (
                      <Pill tone="warn">blockiert</Pill>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {naechster?.notiz ? (
          <div className="rounded-[20px] bg-surface p-5 shadow-soft">
            <p className="text-[12.5px] text-muted">Notiz zum Termin</p>
            <p className="text-[15px]">{naechster.notiz as string}</p>
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
