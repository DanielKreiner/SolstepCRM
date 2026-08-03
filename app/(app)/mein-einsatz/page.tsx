import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { date, num, time, viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mein Einsatz" };

/**
 * Die Ansicht der Montage.
 *
 * Kein Board, keine Beträge, keine Pipeline. Was ein Monteur braucht,
 * wenn er morgens ins Auto steigt: wohin, wann, was ist zu tun, wen ruft
 * er an, was liegt bereit.
 *
 * Die Beträge fehlen nicht, weil sie ausgeblendet sind — die Datenbank
 * liefert sie dieser Rolle gar nicht (v_vorgang_wert hängt an
 * can('angebote'), Migration 0030).
 */
export default async function MeinEinsatzPage() {
  const me = await requireMe();
  const supabase = await createClient();

  const heute = viennaDay();
  const grenze = new Date();
  grenze.setDate(grenze.getDate() - 1);

  const { data: zuordnungen } = await supabase
    .from("vorgang_termin_person")
    .select(
      `termin:termin_id (
         id, art, von, bis, sub_text, notiz,
         vorgang:vorgang_id (
           id, number, phase, adresse, plz, ort, kwp, speicher_kwh, zaehlpunkt,
           customer:customer_id ( name, contact_person, phone )
         )
       )`,
    )
    .eq("user_id", me.id);

  type Zeile = {
    termin: {
      id: string;
      art: string;
      von: string;
      bis: string;
      sub_text: string | null;
      notiz: string | null;
      vorgang: {
        id: string;
        number: string;
        phase: string;
        adresse: string | null;
        plz: string | null;
        ort: string | null;
        kwp: string | null;
        speicher_kwh: string | null;
        zaehlpunkt: string | null;
        customer: {
          name: string;
          contact_person: string | null;
          phone: string | null;
        } | null;
      } | null;
    } | null;
  };

  const termine = ((zuordnungen ?? []) as unknown as Zeile[])
    .map((z) => z.termin)
    .filter((t): t is NonNullable<Zeile["termin"]> => Boolean(t?.vorgang))
    /* Was vorgestern zu Ende war, hilft heute niemandem. */
    .filter((t) => new Date(t.bis) >= grenze)
    .sort((a, b) => a.von.localeCompare(b.von));

  const laufend = termine.filter(
    (t) => t.von.slice(0, 10) <= heute && t.bis.slice(0, 10) >= heute,
  );
  const kommend = termine.filter((t) => t.von.slice(0, 10) > heute);

  /* Material je Vorgang — was auf die Baustelle mitgehört. */
  const ids = termine.map((t) => t.vorgang!.id);
  const { data: material } = ids.length
    ? await supabase
        .from("vorgang_position")
        .select("vorgang_id, bezeichnung, menge, einheit")
        .in("vorgang_id", ids)
        .eq("ist_material", true)
        .is("dokument_id", null)
        .order("sort")
    : { data: [] };

  const jeVorgang = new Map<string, { text: string; menge: number; einheit: string }[]>();
  for (const p of (material ?? []) as unknown as {
    vorgang_id: string;
    bezeichnung: string;
    menge: string;
    einheit: string;
  }[]) {
    const l = jeVorgang.get(p.vorgang_id) ?? [];
    l.push({ text: p.bezeichnung, menge: Number(p.menge), einheit: p.einheit });
    jeVorgang.set(p.vorgang_id, l);
  }

  return (
    <>
      <PageHeader
        title="Mein Einsatz"
        subtitle={`${me.name} · ${date(heute)}`}
      />

      {termine.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
          Kein Einsatz eingeteilt. Sobald das Büro terminiert, steht er hier.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {laufend.length > 0 ? (
            <Block titel="Heute" termine={laufend} material={jeVorgang} heute />
          ) : null}
          {kommend.length > 0 ? (
            <Block titel="Kommende Einsätze" termine={kommend} material={jeVorgang} />
          ) : null}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/m/stempeln"
          className="rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-6 py-[14px] text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)] hover:text-white"
        >
          Zeit stempeln
        </Link>
        <Link
          href="/meine-zeiten"
          className="rounded-pill border border-line bg-surface px-6 py-[14px] text-[14px] font-medium text-ink hover:bg-sunk hover:text-ink"
        >
          Meine Zeiten
        </Link>
      </div>
    </>
  );
}

function Block({
  titel,
  termine,
  material,
  heute = false,
}: {
  titel: string;
  termine: {
    id: string;
    von: string;
    bis: string;
    sub_text: string | null;
    notiz: string | null;
    vorgang: {
      id: string;
      number: string;
      adresse: string | null;
      plz: string | null;
      ort: string | null;
      kwp: string | null;
      speicher_kwh: string | null;
      customer: {
        name: string;
        contact_person: string | null;
        phone: string | null;
      } | null;
    } | null;
  }[];
  material: Map<string, { text: string; menge: number; einheit: string }[]>;
  heute?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[15px] font-semibold">{titel}</h2>
      <ul className="flex flex-col gap-3">
        {termine.map((t) => {
          const v = t.vorgang!;
          const liste = material.get(v.id) ?? [];
          const adresse = [v.adresse, [v.plz, v.ort].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", ");

          return (
            <li key={t.id} className="rounded-[20px] bg-surface p-5 shadow-soft">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-[13px] font-semibold">{v.number}</span>
                {heute ? <Pill tone="doing">läuft</Pill> : null}
                <span className="num ml-auto text-[12px] text-muted">
                  {date(t.von)} {time(t.von)} – {date(t.bis)} {time(t.bis)}
                </span>
              </div>

              <p className="mt-2 text-[17px] leading-snug font-semibold tracking-[-0.02em]">
                {v.customer?.name ?? "—"}
              </p>

              {/*
                Die Adresse ist das Wichtigste auf diesem Screen und
                deshalb ein Link auf die Karte — mit dem Handschuh am
                Handy tippt niemand eine Adresse ab.
              */}
              {adresse ? (
                <a
                  href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(adresse)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-block text-[14px] text-accent-ink underline"
                >
                  {adresse}
                </a>
              ) : (
                <p className="mt-1 text-[13px] text-muted">Keine Adresse hinterlegt.</p>
              )}

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
                {v.kwp ? (
                  <span className="num">
                    <span className="text-muted">Anlage </span>
                    {num(v.kwp, "kWp")}
                    {v.speicher_kwh ? ` + ${num(v.speicher_kwh, "kWh")}` : ""}
                  </span>
                ) : null}
                {v.customer?.contact_person ? (
                  <span>
                    <span className="text-muted">Vor Ort </span>
                    {v.customer.contact_person}
                  </span>
                ) : null}
                {v.customer?.phone ? (
                  <a href={`tel:${v.customer.phone}`} className="num text-accent-ink underline">
                    {v.customer.phone}
                  </a>
                ) : null}
              </dl>

              {t.notiz ? (
                <p className="mt-3 rounded-input bg-panel px-4 py-3 text-[13px]">
                  {t.notiz}
                </p>
              ) : null}
              {t.sub_text ? (
                <p className="mt-2 text-[12px] text-muted">Sub: {t.sub_text}</p>
              ) : null}

              {liste.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[12.5px] font-medium text-muted">
                    Material · {liste.length} Positionen
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {liste.map((p, i) => (
                      <li
                        key={`${t.id}-${i}`}
                        className="flex justify-between gap-3 rounded-input bg-panel px-3 py-2 text-[12.5px]"
                      >
                        <span className="min-w-0 truncate">{p.text}</span>
                        <span className="num shrink-0 font-semibold">
                          {num(p.menge)} {p.einheit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
