import type { Metadata } from "next";
import Link from "next/link";
import { Pill } from "@/components/ui/Pill";
import { dateShort, viennaDay } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Aufträge" };

type Zeile = {
  id: string;
  number: string;
  phase: string;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  customer: { name: string } | null;
  termin: string | null;
};

const PHASE_LABEL: Record<string, string> = {
  beauftragt: "Beauftragt",
  montage: "Montage",
  aufnahme: "Aufnahme",
  angebot: "Angebot",
  anfrage: "Anfrage",
};

/*
 * Auftragsliste der Monteur-App (SPEC 6.1, Bottom-Nav "Aufträge").
 *
 * Anders als /m/heute nicht auf den heutigen Tag begrenzt: hier steht,
 * was ansteht und was gerade läuft. Sortiert nach Termin, offene ohne
 * Termin ganz unten — sie sind noch nicht zugesagt.
 *
 * Abgeschlossene und verlorene Vorgänge bleiben draußen. Wer sie sucht,
 * sucht ein Dokument, und dafür ist das Backoffice zuständig.
 */
export default async function MobileAuftraegePage() {
  await requireMe();
  const supabase = await createClient();
  const heute = viennaDay();

  const [{ data: vorgaenge }, { data: termine }] = await Promise.all([
    supabase
      .from("vorgang")
      .select("id, number, phase, adresse, plz, ort, customer:customer_id ( name )")
      .in("phase", ["aufnahme", "angebot", "beauftragt", "montage"])
      .order("number")
      .limit(80),
    supabase
      .from("vorgang_termin")
      .select("vorgang_id, von")
      .order("von"),
  ]);

  const ersterTermin = new Map<string, string>();
  for (const t of termine ?? []) {
    const id = t.vorgang_id as string;
    if (!ersterTermin.has(id)) ersterTermin.set(id, t.von as string);
  }

  const offen = (
    (vorgaenge ?? []) as unknown as Omit<Zeile, "termin">[]
  ).map((v) => ({ ...v, termin: ersterTermin.get(v.id) ?? null }));

  const laufend = offen.filter(
    (v) => v.termin && v.termin.slice(0, 10) <= heute,
  );
  const kommend = offen.filter(
    (v) => v.termin && v.termin.slice(0, 10) > heute,
  );
  const ohneTermin = offen.filter((v) => !v.termin);

  return (
    <>
      <h1 className="mb-1 text-[24px] font-bold tracking-[-0.02em]">Aufträge</h1>
      <p className="mb-4 text-[13px] text-muted">
        {offen.length} offen · nach Termin sortiert
      </p>

      <Gruppe titel="Läuft" vorgaenge={laufend} />
      <Gruppe titel="Kommt" vorgaenge={kommend} />
      <Gruppe titel="Ohne Termin" vorgaenge={ohneTermin} />

      {offen.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-5 text-[13px] text-muted shadow-soft">
          Kein offener Auftrag.
        </p>
      ) : null}
    </>
  );
}

function Gruppe({
  titel,
  vorgaenge,
}: {
  titel: string;
  vorgaenge: Zeile[];
}) {
  if (vorgaenge.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
        {titel}
        <span className="num rounded-pill bg-sunk px-[8px] py-[2px] text-[11px] font-normal text-muted">
          {vorgaenge.length}
        </span>
      </h2>

      <ul className="flex flex-col gap-3">
        {vorgaenge.map((v) => (
          <li key={v.id}>
            <Link
              href={`/m/auftrag/${v.id}`}
              className="block min-h-[56px] rounded-[20px] bg-surface p-[18px] text-ink shadow-soft"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-[12.5px] font-semibold">{v.number}</span>
                <Pill tone="doing">{PHASE_LABEL[v.phase] ?? v.phase}</Pill>
                {v.termin ? (
                  <span className="num ml-auto text-[11.5px] text-faint">
                    {dateShort(v.termin)}
                  </span>
                ) : null}
              </div>

              <p className="mt-[6px] text-[16px] leading-snug font-semibold">
                {v.customer?.name ?? "—"}
              </p>
              <p className="text-[13px] text-muted">
                {[v.adresse, [v.plz, v.ort].filter(Boolean).join(" ")]
                  .filter(Boolean)
                  .join(", ") || "keine Adresse hinterlegt"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
