import type { Metadata } from "next";
import Link from "next/link";
import { Abschnitt } from "@/components/ui/Abschnitt";
import { Avatar } from "@/components/ui/Avatar";
import { LinkButton } from "@/components/ui/Button";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { PageHeader } from "@/components/ui/PageHeader";
import { dateTime, eur, eurShort, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { AnlageForm, KundeAnlegen, KundeBearbeiten } from "./KundenForms";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "CRM" };

type Kunde = {
  id: string;
  type: string;
  number: string | null;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  zip: string | null;
  city: string | null;
  source: string | null;
  crm_stage: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
};

/*
 * Alle sechs Arten aus dem Schema. Vorher fehlten "quote" und "system" —
 * die beiden, die die Trigger aus 0007 am häufigsten schreiben. In der
 * Liste stand deshalb der rohe Schlüssel.
 */
const AKTIVITAET_LABEL: Record<string, string> = {
  call: "Anruf",
  mail: "Mail",
  portal: "Kundenportal",
  note: "Notiz",
  quote: "Angebot",
  system: "Auftrag",
};

const FILTER = [
  ["alle", "Alle"],
  ["customer", "Kunden"],
  ["lead", "Leads"],
] as const;

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ typ?: string; kunde?: string; bearbeiten?: string }>;
}) {
  const me = await requireMe();
  const {
    typ: rohTyp,
    kunde: gewaehlt,
    bearbeiten,
  } = await searchParams;
  const darfSchreiben = me.perms.crm === "write";
  const typ = FILTER.some(([k]) => k === rohTyp) ? rohTyp! : "alle";
  const supabase = await createClient();

  const [
    { data: alleKunden },
    { data: aktivitaeten },
    { data: anlagen },
    { data: jobs },
    { data: rechnungen },
    { data: angebote },
  ] = await Promise.all([
    supabase
      .from("customer")
      .select(
        "id, type, number, name, contact_person, email, phone, address, zip, city, source, crm_stage, notes, deleted_at, created_at",
      )
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("contact_activity")
      .select("id, customer_id, kind, body, created_at")
      .order("created_at", { ascending: false })
      .limit(400),
    supabase
      .from("plant")
      .select(
        "id, customer_id, kwp, storage_kwh, modules, inverter, meter_point, commissioned_on",
      ),
    supabase
      .from("job")
      .select("id, customer_id, value_net, phase:phase_id ( system_key )"),
    supabase
      .from("invoice")
      .select("id, job_id, amount_net, paid_amount, status"),
    supabase.from("quote").select("id, customer_id, net_total, status, accepted_at"),
  ]);

  const kunden = (alleKunden ?? []) as unknown as Kunde[];
  const gefiltert =
    typ === "alle" ? kunden : kunden.filter((k) => k.type === typ);

  // --- Zuordnungen ---
  const aktivitaetJe = new Map<
    string,
    { kind: string; body: string | null; created_at: string }[]
  >();
  for (const a of aktivitaeten ?? []) {
    const cid = a.customer_id as string;
    if (!aktivitaetJe.has(cid)) aktivitaetJe.set(cid, []);
    aktivitaetJe.get(cid)!.push({
      kind: a.kind as string,
      body: (a.body as string | null) ?? null,
      created_at: a.created_at as string,
    });
  }

  type AnlageZeile = {
    id: string;
    customer_id: string;
    kwp: string | null;
    storage_kwh: string | null;
    modules: string | null;
    inverter: string | null;
    meter_point: string | null;
    commissioned_on: string | null;
  };
  const anlageZeilen = (anlagen ?? []) as unknown as AnlageZeile[];

  const anlagenJe = new Map<string, number>();
  for (const p of anlageZeilen) {
    anlagenJe.set(p.customer_id, (anlagenJe.get(p.customer_id) ?? 0) + 1);
  }

  type JobZeile = {
    id: string;
    customer_id: string;
    value_net: string;
    phase: { system_key: string | null } | null;
  };
  const jobZeilen = (jobs ?? []) as unknown as JobZeile[];

  const umsatzJe = new Map<string, number>();
  const aktiveJe = new Map<string, number>();
  const jobZuKunde = new Map<string, string>();
  for (const j of jobZeilen) {
    jobZuKunde.set(j.id, j.customer_id);
    umsatzJe.set(
      j.customer_id,
      (umsatzJe.get(j.customer_id) ?? 0) + Number(j.value_net),
    );
    if (j.phase?.system_key !== "closed") {
      aktiveJe.set(j.customer_id, (aktiveJe.get(j.customer_id) ?? 0) + 1);
    }
  }

  const offenJe = new Map<string, number>();
  for (const r of rechnungen ?? []) {
    if (r.status === "paid" || r.status === "cancelled") continue;
    const cid = jobZuKunde.get(r.job_id as string);
    if (!cid) continue;
    offenJe.set(
      cid,
      (offenJe.get(cid) ?? 0) + (Number(r.amount_net) - Number(r.paid_amount)),
    );
  }

  const offeneAngeboteJe = new Map<string, number>();
  for (const q of angebote ?? []) {
    if (q.accepted_at || q.status === "lost" || q.status === "draft") continue;
    const cid = q.customer_id as string;
    offeneAngeboteJe.set(
      cid,
      (offeneAngeboteJe.get(cid) ?? 0) + Number(q.net_total),
    );
  }

  // --- Kennzahlen ---
  const leads = kunden.filter((k) => k.type === "lead");
  const bestand = kunden.filter((k) => k.type === "customer");
  const pipelineWert = [...offeneAngeboteJe.values()].reduce((s, v) => s + v, 0);

  const entschieden = (angebote ?? []).filter(
    (q) => q.accepted_at !== null || q.status === "lost",
  );
  const abschlussquote =
    entschieden.length > 0
      ? Math.round(
          (entschieden.filter((q) => q.accepted_at !== null).length /
            entschieden.length) *
            100,
        )
      : 0;

  const detail = gewaehlt
    ? (kunden.find((k) => k.id === gewaehlt) ?? null)
    : (gefiltert[0] ?? null);

  /*
   * Ein Kunde kann mehrere Anlagen haben; das Formular bearbeitet die erste.
   * Mehrere Anlagen je Kunde sind selten und gehören auf einen eigenen
   * Screen — hier würde eine Liste von Formularen die Seite sprengen.
   */
  const anlageRoh = detail
    ? anlageZeilen.find((a) => a.customer_id === detail.id)
    : undefined;

  const anlageDetail = anlageRoh
    ? {
        id: anlageRoh.id,
        kwp: anlageRoh.kwp === null ? null : Number(anlageRoh.kwp),
        storageKwh:
          anlageRoh.storage_kwh === null ? null : Number(anlageRoh.storage_kwh),
        modules: anlageRoh.modules,
        inverter: anlageRoh.inverter,
        meterPoint: anlageRoh.meter_point,
        commissionedOn: anlageRoh.commissioned_on,
      }
    : undefined;

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Leads, Kunden und Aktivitäten"
        actions={
          <>
            {darfSchreiben ? <KundeAnlegen /> : null}
            <LinkButton href="/pipelines/vertrieb" variant="ghost">
              Vertriebspipeline
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Offene Angebote"
          wert={eurShort(pipelineWert)}
          pille={`${offeneAngeboteJe.size} ${offeneAngeboteJe.size === 1 ? "Kunde" : "Kunden"}`}
          notiz="versendet, noch nicht entschieden"
        />
        <KpiKarte
          label="Bestandskunden"
          wert={bestand.length}
          ton="gut"
          notiz="mindestens ein Auftrag"
        />
        <KpiKarte
          label="Leads"
          wert={leads.length}
          notiz="noch kein Auftrag"
        />
        <KpiKarte
          label="Abschlussquote"
          wert={`${abschlussquote} %`}
          pille={`${entschieden.length} entschieden`}
          ton={abschlussquote >= 40 ? "gut" : "neutral"}
          notiz="angenommen gegen verloren"
        />
      </div>

      {/* Filterchips wie in der Vorlage — Zustand in der URL, damit ein Link teilbar bleibt. */}
      <nav className="mb-4 flex flex-wrap gap-[3px] self-start rounded-pill bg-surface p-1 shadow-soft">
        {FILTER.map(([key, label]) => {
          const anzahl =
            key === "alle"
              ? kunden.length
              : kunden.filter((k) => k.type === key).length;
          return (
            <Link
              key={key}
              href={key === "alle" ? "/crm" : `/crm?typ=${key}`}
              className={[
                "flex items-center gap-[9px] rounded-pill px-[17px] py-[9px] text-[13.5px] transition-colors",
                key === typ
                  ? "bg-sunk font-semibold text-ink"
                  : "font-normal text-muted hover:text-ink",
              ].join(" ")}
            >
              {label}
              <span className="num text-[11px] opacity-70">{anzahl}</span>
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] xl:items-start">
        <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[1.7fr_130px_110px_1.4fr_120px] border-b border-line px-4 text-[11px] tracking-[0.07em] text-faint uppercase">
              {["Kunde", "Ort", "Anlagen", "Letzte Aktivität", "Umsatz"].map(
                (h, i) => (
                  <div
                    key={h}
                    className={`px-2 py-[14px] ${i === 4 ? "text-right" : ""}`}
                  >
                    {h}
                  </div>
                ),
              )}
            </div>

            {gefiltert.length === 0 ? (
              <p className="px-6 py-8 text-[13.5px] text-muted">
                Kein Eintrag in dieser Auswahl.
              </p>
            ) : (
              gefiltert.map((k) => {
                const letzte = aktivitaetJe.get(k.id)?.[0] ?? null;
                const aktiv = detail?.id === k.id;
                const anzahlAnlagen = anlagenJe.get(k.id) ?? 0;
                return (
                  <Link
                    key={k.id}
                    href={zeilenLink(typ, k.id)}
                    scroll={false}
                    className={[
                      "grid grid-cols-[1.7fr_130px_110px_1.4fr_120px] items-center border-b border-line px-4 text-ink last:border-b-0",
                      "transition-colors duration-200 hover:bg-panel hover:text-ink",
                      aktiv ? "bg-accent-sunk" : "",
                    ].join(" ")}
                  >
                    <div className="flex min-w-0 items-center gap-3 px-2 py-3">
                      <Avatar name={k.name} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium">
                          {k.name}
                        </span>
                        <span className="block truncate text-[11.5px] text-faint">
                          {k.type === "lead" ? "Lead" : "Bestandskunde"}
                          {k.source ? ` · ${k.source}` : ""}
                        </span>
                      </span>
                    </div>
                    <div className="px-2 py-3 text-[12.5px] text-muted">
                      {k.city ?? "—"}
                    </div>
                    <div className="num px-2 py-3 text-[12.5px] text-muted">
                      {anzahlAnlagen === 0
                        ? "—"
                        : `${anzahlAnlagen} ${anzahlAnlagen === 1 ? "Anlage" : "Anlagen"}`}
                    </div>
                    <div className="min-w-0 px-2 py-3">
                      {letzte ? (
                        <>
                          <span className="block truncate text-[12.5px]">
                            {AKTIVITAET_LABEL[letzte.kind] ?? letzte.kind}
                          </span>
                          <span className="num block truncate text-[11px] text-faint">
                            {dateTime(letzte.created_at)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[12px] text-faint">
                          keine Aktivität
                        </span>
                      )}
                    </div>
                    <div className="num px-2 py-3 text-right text-[13px] font-semibold">
                      {umsatzJe.get(k.id)
                        ? eurShort(umsatzJe.get(k.id)!)
                        : "—"}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {detail ? (
          <div className="flex flex-col gap-4">
            {/*
              Bearbeiten liegt hinter ?bearbeiten= und nicht hinter einem
              Client-Umschalter: nach dem Speichern soll man dort landen, wo
              man war, und ein Link auf "Kunde XY bearbeiten" soll ein Link
              sein.
            */}
            {darfSchreiben ? (
              <nav className="flex flex-wrap gap-[3px] rounded-pill bg-surface p-1 shadow-soft">
                {[
                  ["", "Übersicht"],
                  ["stammdaten", "Stammdaten"],
                  ["anlage", "Anlage"],
                ].map(([key, label]) => {
                  const an = (bearbeiten ?? "") === key;
                  const p = new URLSearchParams();
                  if (typ !== "alle") p.set("typ", typ);
                  p.set("kunde", detail.id);
                  if (key) p.set("bearbeiten", key);
                  return (
                    <Link
                      key={label}
                      href={`/crm?${p.toString()}`}
                      scroll={false}
                      className={[
                        "rounded-pill px-[15px] py-[8px] text-[12.5px] transition-colors",
                        an
                          ? "bg-sunk font-semibold text-ink"
                          : "text-muted hover:text-ink",
                      ].join(" ")}
                    >
                      {label}
                    </Link>
                  );
                })}
              </nav>
            ) : null}

            {darfSchreiben && bearbeiten === "stammdaten" ? (
              <KundeBearbeiten
                kunde={{
                  id: detail.id,
                  name: detail.name,
                  type: detail.type,
                  contactPerson: detail.contact_person,
                  email: detail.email,
                  phone: detail.phone,
                  address: detail.address,
                  zip: detail.zip,
                  city: detail.city,
                  source: detail.source,
                  notes: detail.notes,
                  archiviert: detail.deleted_at !== null,
                }}
              />
            ) : null}

            {darfSchreiben && bearbeiten === "anlage" ? (
              <AnlageForm
                customerId={detail.id}
                anlage={anlageDetail}
              />
            ) : null}

            <Abschnitt
              titel={
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={detail.name} size={34} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">
                      {detail.name}
                    </span>
                    <span className="block truncate text-[11.5px] font-normal text-faint">
                      {detail.type === "lead" ? "Lead" : "Bestandskunde"} seit{" "}
                      {new Date(detail.created_at).getFullYear()}
                    </span>
                  </span>
                </span>
              }
            >
              <p className="text-[12.5px] text-muted">
                {[
                  detail.address,
                  [detail.zip, detail.city].filter(Boolean).join(" "),
                ]
                  .filter(Boolean)
                  .join(", ") || "Keine Adresse hinterlegt"}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Kachel
                  label="Umsatz gesamt"
                  wert={eur(umsatzJe.get(detail.id) ?? 0)}
                />
                <Kachel
                  label="Offene Posten"
                  wert={eur(offenJe.get(detail.id) ?? 0)}
                  ton={(offenJe.get(detail.id) ?? 0) > 0 ? "crit" : undefined}
                />
                <Kachel
                  label="Aufträge aktiv"
                  wert={num(aktiveJe.get(detail.id) ?? 0)}
                />
                <Kachel
                  label="Anlagen"
                  wert={num(anlagenJe.get(detail.id) ?? 0)}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {detail.phone ? (
                  <a
                    href={`tel:${detail.phone}`}
                    className="rounded-pill bg-sunk px-[15px] py-[9px] text-[12.5px] font-medium text-ink hover:bg-line hover:text-ink"
                  >
                    Anrufen
                  </a>
                ) : null}
                {detail.email ? (
                  <a
                    href={`mailto:${detail.email}`}
                    className="rounded-pill bg-sunk px-[15px] py-[9px] text-[12.5px] font-medium text-ink hover:bg-line hover:text-ink"
                  >
                    Mail schreiben
                  </a>
                ) : null}
                {!detail.phone && !detail.email ? (
                  <span className="text-[12px] text-faint">
                    Weder Telefon noch Mail hinterlegt.
                  </span>
                ) : null}
              </div>
            </Abschnitt>

            <Abschnitt titel="Aktivitäten">
              {(aktivitaetJe.get(detail.id) ?? []).length === 0 ? (
                <p className="text-[13px] text-muted">
                  Noch keine Aktivität. Portalzugriffe, Mails und
                  Angebotsereignisse laufen automatisch hier ein.
                </p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {(aktivitaetJe.get(detail.id) ?? []).slice(0, 10).map((a, i) => (
                    <li key={`${a.created_at}-${i}`} className="flex gap-[10px]">
                      <span
                        aria-hidden
                        className={[
                          "mt-[6px] h-[7px] w-[7px] shrink-0 rounded-pill",
                          a.kind === "portal"
                            ? "bg-s-doing"
                            : a.kind === "call"
                              ? "bg-s-done"
                              : a.kind === "mail"
                                ? "bg-s-waiting"
                                : a.kind === "quote"
                                  ? "bg-accent"
                                  : "bg-line-strong",
                        ].join(" ")}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">
                          {AKTIVITAET_LABEL[a.kind] ?? a.kind}
                        </span>
                        {a.body ? (
                          <span className="block text-[12px] text-muted">
                            {a.body}
                          </span>
                        ) : null}
                        <span className="num block text-[11px] text-faint">
                          {dateTime(a.created_at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Abschnitt>
          </div>
        ) : null}
      </div>
    </>
  );
}

/*
 * Auswahl und Filter stehen beide in der URL, damit ein Link auf einen
 * Kunden den Filter mitnimmt, aus dem man ihn geöffnet hat.
 */
function zeilenLink(typ: string, kundeId: string): string {
  const p = new URLSearchParams();
  if (typ !== "alle") p.set("typ", typ);
  p.set("kunde", kundeId);
  return `/crm?${p.toString()}`;
}

function Kachel({
  label,
  wert,
  ton,
}: {
  label: string;
  wert: string;
  // exactOptionalPropertyTypes ist an: wer den Wert rechnerisch auf
  // undefined setzt, muss das auch übergeben dürfen.
  ton?: "crit" | undefined;
}) {
  return (
    <div className="rounded-input bg-panel px-4 py-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div
        className={`num mt-[2px] text-[15px] font-semibold ${ton === "crit" ? "text-s-crit" : ""}`}
      >
        {wert}
      </div>
    </div>
  );
}
