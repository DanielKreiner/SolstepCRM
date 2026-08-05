import type { Metadata } from "next";
import { Pill } from "@/components/ui/Pill";
import { date, time, viennaDay } from "@/lib/format";
import { beladeliste } from "@/lib/material/beladeliste";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, endOfViennaDay, startOfViennaDay } from "@/lib/time";
import { Einsatzkarte, OhnePlan, type Einsatz } from "./Einsatzkarte";

export const metadata: Metadata = { title: "Heute" };

/**
 * Der wichtigste Screen des Produkts.
 *
 * Ein Monteur macht ihn um halb sieben im Auto auf und will drei Dinge
 * wissen: wohin, mit wem, was ist zu laden. Und er will einmal tippen,
 * damit die Zeit läuft — am richtigen Auftrag, ohne Umweg über eine
 * Uhr auf einer anderen Seite.
 */
export default async function HeutePage() {
  const me = await requireMe();
  const supabase = await createClient();
  const heute = viennaDay();

  const [{ data: roh }, { data: laufend }, liste] = await Promise.all([
    supabase
      .from("einsatz")
      .select(
        `id, art, titel, von, bis, vorgang_id, notiz,
         personen:einsatz_person ( user_id, user:user_id ( name ) ),
         vorgang:vorgang_id ( adresse, plz, ort, customer:customer_id ( name, contact_person, phone ) ),
         kunde:kunde_id ( name, address, zip, city, contact_person, phone )`,
      )
      .gte("von", startOfViennaDay(heute).toISOString())
      .lte("von", endOfViennaDay(addDays(heute, 7)).toISOString())
      .order("von"),
    supabase
      .from("time_entry")
      .select("id, started_at, einsatz_id")
      .eq("user_id", me.id)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    beladeliste(supabase, { companyId: me.companyId, tag: heute, userId: me.id }),
  ]);

  type Roh = {
    id: string;
    art: string;
    titel: string | null;
    von: string;
    bis: string;
    vorgang_id: string | null;
    notiz: string | null;
    personen: { user_id: string; user: { name: string } | null }[];
    /* Serviceeinsatz ohne Vorgang: Adresse und Kontakt vom Kunden. */
    kunde: {
      name: string;
      address: string | null;
      zip: string | null;
      city: string | null;
      contact_person: string | null;
      phone: string | null;
    } | null;
    vorgang: {
      adresse: string | null;
      plz: string | null;
      ort: string | null;
      customer: {
        name: string;
        contact_person: string | null;
        phone: string | null;
      } | null;
    } | null;
  };

  /* Nur die eigenen Einsätze — die Zuordnung steckt in einer Untertabelle. */
  const meine = ((roh ?? []) as unknown as Roh[]).filter((e) =>
    e.personen.some((p) => p.user_id === me.id),
  );

  const bisEnde = endOfViennaDay(heute).getTime();
  const heutige = meine.filter((e) => new Date(e.von).getTime() <= bisEnde);
  const kommende = meine.filter((e) => new Date(e.von).getTime() > bisEnde);

  const laeuftSeit = (laufend?.started_at as string | null) ?? null;
  const laeuftAn = (laufend?.einsatz_id as string | null) ?? null;

  const abbilden = (e: Roh): Einsatz => {
    const block = liste.bloecke.find((b) => b.vorgangId === e.vorgang_id);
    return {
      id: e.id,
      art: e.art,
      titel: e.titel ?? "Einsatz",
      vonZeit: time(e.von),
      bisZeit: time(e.bis),
      /*
       * Die Baustelle steht am Vorgang; ohne Vorgang bleibt der
       * Kundensitz. Ein Serviceeinsatz ohne beides schickte den Monteur
       * bisher mit einem Freitexttitel los.
       */
      adresse:
        [e.vorgang?.adresse, [e.vorgang?.plz, e.vorgang?.ort].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ") ||
        [e.kunde?.address, [e.kunde?.zip, e.kunde?.city].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ") ||
        null,
      kunde: e.vorgang?.customer?.name ?? e.kunde?.name ?? null,
      kontakt:
        e.vorgang?.customer?.contact_person ?? e.kunde?.contact_person ?? null,
      telefon: e.vorgang?.customer?.phone ?? e.kunde?.phone ?? null,
      notiz: e.notiz,
      team: e.personen
        .filter((p) => p.user_id !== me.id)
        .map((p) => p.user?.name)
        .filter((n): n is string => Boolean(n)),
      vorgangId: e.vorgang_id,
      zuLaden: block?.zuLaden.length ?? 0,
      fehlt: block?.fehlt.length ?? 0,
      lieferungen: liste.lieferungen.filter(
        (l) => l.vorgangNummer && e.vorgang_id,
      ).length,
    };
  };

  return (
    <>
      <h1 className="mb-1 text-[24px] font-bold tracking-[-0.02em]">Heute</h1>
      <p className="mb-4 text-[13px] text-muted">
        {date(heute)}
        {liste.fahrzeug ? ` · ${liste.fahrzeug.name}` : ""}
      </p>

      {heutige.length === 0 ? (
        <section className="mb-4 rounded-[20px] bg-surface p-6 shadow-soft">
          <h2 className="text-[16px] font-semibold">Kein Einsatz geplant</h2>
          <p className="mt-1 text-[13px] text-muted">
            Wenn du trotzdem arbeitest, starte die Zeit hier — sag kurz woran.
          </p>
        </section>
      ) : (
        <div className="mb-4 flex flex-col gap-4">
          {heutige.map((e) => (
            <Einsatzkarte
              key={e.id}
              einsatz={abbilden(e)}
              laeuftSeit={laeuftSeit}
              laeuftHier={laeuftAn === e.id}
            />
          ))}
        </div>
      )}

      <div className="mb-6">
        <OhnePlan
          gesperrt={Boolean(laeuftSeit)}
          einsaetze={heutige
            .filter((e) => e.id !== laeuftAn)
            .map((e) => ({
              id: e.id,
              label: `${time(e.von)} · ${e.vorgang?.customer?.name ?? e.titel ?? "Einsatz"}`,
            }))}
        />
      </div>

      {kommende.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">Die nächsten Tage</h2>
          <ul className="flex flex-col gap-[6px]">
            {kommende.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-2 rounded-card bg-surface px-4 py-3 shadow-soft"
              >
                <span className="num w-[92px] shrink-0 text-[13px] font-semibold">
                  {date(e.von)}
                </span>
                <span className="num w-[52px] shrink-0 text-[12.5px] text-muted">
                  {time(e.von)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {e.vorgang?.customer?.name ?? e.titel ?? "Einsatz"}
                </span>
                {e.art === "service" ? <Pill tone="waiting">Service</Pill> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
