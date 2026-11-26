import type { Metadata } from "next";
import Link from "next/link";
import { Abschnitt } from "@/components/ui/Abschnitt";
import { Einrichtung, type Punkt } from "./Einrichtung";
import {
  Unterlagen,
  type UnterlagenDatei,
  type UnterlagenPunkt,
} from "./Unterlagen";
import { KreisForm, type KreisWerte } from "./Nummernkreise";
import {
  NachweisForm,
  NachweisNeu,
  type NachweisWerte,
} from "./Nachweiskatalog";
import {
  FahrzeugForm,
  FahrzeugNeu,
  LagerortForm,
  LagerortNeu,
  type FahrzeugWerte,
  type LagerWerte,
} from "./Betriebsmittel";
import {
  type ModulZeile,
  PlanerStammdaten,
  type SpeicherZeile,
  type WrZeile,
} from "./PlanerStammdaten";
import {
  type FoerderZeile,
  PlanerVorgaben,
  type VorgabeZeile,
} from "./PlanerVorgaben";
import { ChecklisteForm, FirmaForm, MarkeForm } from "./MarkeForms";
import { date } from "@/lib/format";
import { ausJson } from "@/lib/rules/zeitregeln";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { PageHeader } from "@/components/ui/PageHeader";
import { ROLE_LABEL } from "@/lib/nav";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  PermissionCell,
  StandortForm,
  StandortLoeschen,
  StandortNeu,
  ZeitregelnForm,
  type StandortWerte,
} from "./SettingsForms";

export const metadata: Metadata = { title: "Einstellungen" };

/*
 * Die offenen Punkte beim Start (0078) samt ihren Dateien.
 *
 * Die Leseadressen werden hier signiert und nicht im Browser geholt:
 * `documents` ist ein privater Bucket, und eine Signatur gehört auf den
 * Server. 60 Minuten nach CLAUDE.md 4.4 — die Seite wird bei jeder
 * Änderung neu gebaut, damit reicht das.
 */
async function unterlagenLaden(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<UnterlagenPunkt[]> {
  const [{ data: punkte }, { data: dateien }] = await Promise.all([
    supabase
      .from("einrichtung_punkt")
      .select(
        "id, schluessel, bereich, sortierung, titel, grund, art, optionen, dringend, wert, anmerkung, status, beantwortet_am, app_user(name)",
      )
      .order("sortierung"),
    supabase
      .from("einrichtung_datei")
      .select("id, punkt_id, dateiname, groesse_bytes, storage_path")
      .order("created_at"),
  ]);

  if (!punkte || punkte.length === 0) return [];

  /*
   * Eine Signatur je Datei, aber in einem Aufruf. Einzeln wären es bei
   * einem vollen Katalog zwei Dutzend Rundreisen zum Storage-Dienst.
   */
  const pfade = (dateien ?? []).map((d) => d.storage_path as string);
  const links = new Map<string, string>();
  if (pfade.length > 0) {
    const { data: signiert } = await supabase.storage
      .from("documents")
      .createSignedUrls(pfade, 60 * 60);
    for (const s of signiert ?? []) {
      if (s.path && s.signedUrl) links.set(s.path, s.signedUrl);
    }
  }

  const jePunkt = new Map<string, UnterlagenDatei[]>();
  for (const d of dateien ?? []) {
    const liste = jePunkt.get(d.punkt_id as string) ?? [];
    liste.push({
      id: d.id as string,
      dateiname: d.dateiname as string,
      groesseBytes: d.groesse_bytes === null ? null : Number(d.groesse_bytes),
      link: links.get(d.storage_path as string) ?? null,
    });
    jePunkt.set(d.punkt_id as string, liste);
  }

  return punkte.map((p) => {
    const person = p.app_user as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(person) ? person[0]?.name : person?.name;
    return {
      id: p.id as string,
      schluessel: p.schluessel as string,
      bereich: p.bereich as string,
      titel: p.titel as string,
      grund: (p.grund as string | null) ?? null,
      art: p.art as UnterlagenPunkt["art"],
      optionen: (p.optionen as string[] | null) ?? [],
      dringend: Boolean(p.dringend),
      wert: (p.wert as string | null) ?? null,
      anmerkung: (p.anmerkung as string | null) ?? null,
      status: p.status as UnterlagenPunkt["status"],
      beantwortetVon: name ?? null,
      beantwortetAm: p.beantwortet_am ? date(p.beantwortet_am as string) : null,
      dateien: jePunkt.get(p.id as string) ?? [],
    };
  });
}

const AREAS = [
  ["pipelines", "Pipelines"],
  ["planer", "Planer"],
  ["angebote", "Angebote"],
  ["crm", "CRM"],
  ["lager", "Lager"],
  ["rechnungen", "Rechnungen"],
  ["zeiterfassung", "Zeiterfassung"],
  ["mitarbeiter", "Mitarbeiter"],
  ["berichte", "Berichte"],
  ["einstellungen", "Einstellungen"],
] as const;

const ROLES = ["gf", "buero", "bauleitung", "monteur", "lager"] as const;

/*
 * Unternavigation wie in der Vorlage. Der aktive Bereich steht in der URL
 * und nicht im Client-State: ein Link auf die Nummernkreise soll ein Link
 * sein, und nach dem Speichern eines Standorts landet man wieder dort, wo
 * man war.
 */
const BEREICHE = [
  ["einrichtung", "Einrichtung"],
  ["rechte", "Rollen und Rechte"],
  ["firma", "Firmendaten"],
  ["erscheinungsbild", "Erscheinungsbild"],
  ["checklisten", "Checklisten"],
  ["planer", "Planer-Stammdaten"],
  ["standorte", "Standorte"],
  ["betriebsmittel", "Fahrzeuge und Lager"],
  ["nachweise", "Nachweise"],
  ["zeit", "Zeiterfassung"],
  ["nummernkreise", "Nummernkreise"],
  ["integrationen", "Integrationen"],
  ["daten", "Daten mitnehmen"],
] as const;

type Bereich = (typeof BEREICHE)[number][0];

const STATUS_TEXT: Record<string, string> = {
  trial: "Testphase",
  active: "Aktiv",
  readonly: "Nur lesen",
  cancelled: "Gekündigt",
};

/*
 * Die vier Belegarten, die heute Nummern ziehen. "quote" und "job"
 * standen hier noch aus der Zeit vor dem Vorgangs-Umbau — die Tabellen
 * dazu gibt es seit 0039 nicht mehr, und ein Nummernkreis, den niemand
 * zieht, verwirrt nur.
 */
const NUMMERNKREISE = [
  { kind: "vorgang", label: "Vorgänge", praefix: "V" },
  { kind: "invoice", label: "Rechnungen", praefix: "RE" },
  { kind: "ticket", label: "Serviceanliegen", praefix: "S" },
  { kind: "purchase_order", label: "Bestellungen", praefix: "B" },
] as const;

export default async function EinstellungenPage({
  searchParams,
}: {
  searchParams: Promise<{ bereich?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();
  const { bereich: roh } = await searchParams;

  const gewaehlt: Bereich | null = BEREICHE.some(([k]) => k === roh)
    ? (roh as Bereich)
    : null;

  const darfSchreiben = me.perms.einstellungen === "write";

  const [
    { data: perms },
    { data: company },
    { data: standorte },
    { data: leute },
    { data: zaehlerstand },
    { data: postfaecher },
    { data: planerModule },
    { data: planerWr },
    { data: planerSpeicher },
    { data: planerVorgabe },
    { data: planerFoerderung },
  ] = await Promise.all([
    supabase.from("role_permission").select("role, area, level"),
    supabase
      .from("company")
      .select(
        "name, uid_nr, address, zip, city, country, iban, bic, rechtsform, firmenbuch_nr, firmenbuch_gericht, email, phone, website, status, plan, seats, time_settings, pdf_settings, onboarded_at",
      )
      .maybeSingle(),
    supabase
      .from("location")
      .select("id, name, address, zip, city, holiday_region, min_staffing, worktime_rules")
      .order("name"),
    supabase.from("app_user").select("id, location_id").eq("active", true),
    supabase
      .from("doc_counter")
      .select("kind, year, value")
      .order("year", { ascending: false }),
    supabase
      .from("v_mail_account")
      .select("id, address, provider, status, last_sync_at, is_default"),
    /*
     * Planer-Stammdaten. Eigene Geräte UND der gemeinsame Katalog — die
     * RLS-Policy liefert beides, sortiert wird nach Hersteller, damit
     * Kopien neben ihrem Original stehen.
     */
    supabase
      .from("planer_modul")
      .select("*")
      .order("hersteller")
      .order("bezeichnung"),
    supabase
      .from("planer_wechselrichter")
      .select("*")
      .order("hersteller")
      .order("bezeichnung"),
    supabase
      .from("planer_speicher")
      .select("*")
      .order("hersteller")
      .order("bezeichnung"),
    /*
     * Rechenvorgaben und Fördersätze. Sie wirken auf jedes Angebot des
     * Planers und liegen deshalb hier, nicht im Planer selbst.
     */
    supabase
      .from("planer_wirtschaft_vorgabe")
      .select("verlust_prozent, steigerung, strompreis, verguetung, preisstaffel, speicher_eur_pro_kwh")
      .maybeSingle(),
    supabase.from("planer_foerderung").select("region, betrag, hinweis").order("region"),
  ]);

  /*
   * Solange der Betrieb nicht als eingerichtet markiert ist, ist die
   * Einrichtung der erste Bildschirm. Danach ist sie einer von vielen —
   * wer täglich eine Rolle umstellt, will nicht jedes Mal an einer
   * Checkliste vorbei.
   */
  /*
   * Das laufende Jahr in Wiener Zeit — der Nummernkreis ist je Jahr
   * eigenständig, und am 1. Jänner um 00:30 wäre es nach UTC noch das
   * alte.
   */
  const JAHR = Number(
    new Intl.DateTimeFormat("de-AT", {
      timeZone: "Europe/Vienna",
      year: "numeric",
    }).format(new Date()),
  );

  const eingerichtet = Boolean(company?.onboarded_at);
  const bereich: Bereich = gewaehlt ?? (eingerichtet ? "rechte" : "einrichtung");

  const [{ count: vorgaenge }, { count: artikel }] =
    bereich === "einrichtung"
      ? await Promise.all([
          supabase.from("vorgang").select("id", { count: "exact", head: true }),
          supabase
            .from("article")
            .select("id", { count: "exact", head: true })
            .eq("active", true),
        ])
      : [{ count: null }, { count: null }];

  const unterlagen =
    bereich === "einrichtung" ? await unterlagenLaden(supabase) : [];

  const [{ data: nachweise }, { data: traegerListe }] =
    bereich === "nachweise"
      ? await Promise.all([
          supabase
            .from("qualifikation")
            .select("id, schluessel, label, nachweis")
            .order("sort"),
          supabase.from("app_user").select("qualifikationen"),
        ])
      : [{ data: null }, { data: null }];

  const [{ data: fahrzeuge }, { data: lagerorte }] =
    bereich === "betriebsmittel"
      ? await Promise.all([
          supabase
            .from("fahrzeug")
            .select("id, name, kennzeichen, aktiv")
            .order("sort"),
          supabase
            .from("lagerort")
            .select("id, name, aktiv, art")
            .eq("art", "hauptlager")
            .order("sort"),
        ])
      : [{ data: null }, { data: null }];

  /*
   * Nur laden, wenn der Bereich offen ist — die Einstellungen holen
   * ohnehin schon reichlich, und niemand braucht die Checkliste, um
   * eine Rolle umzustellen.
   */
  const { data: checkliste } =
    bereich === "checklisten"
      ? await supabase
          .from("checkliste_vorlage")
          .select(
            "id, name, punkte:checkliste_punkt_vorlage ( id, label, hinweis, typ, pflicht, sort )",
          )
          .eq("art", "aufnahme")
          .limit(1)
          .maybeSingle()
      : { data: null };

  const marke = (company?.pdf_settings ?? {}) as Record<string, unknown>;

  const permMap = new Map<string, string>();
  for (const p of perms ?? []) {
    permMap.set(`${p.role as string}:${p.area as string}`, p.level as string);
  }

  const proStandort = new Map<string, number>();
  for (const p of leute ?? []) {
    const l = p.location_id as string | null;
    if (l) proStandort.set(l, (proStandort.get(l) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Einstellungen"
        subtitle="Rollen, Standorte, Nummernkreise, Integrationen."
      />

      <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        <KpiKarte
          akzent
          label="Mandant"
          wert={
            <span className="text-[19px] leading-tight">
              {(company?.name as string) ?? "—"}
            </span>
          }
          notiz={[company?.zip, company?.city].filter(Boolean).join(" ")}
        />
        <KpiKarte
          label="Status"
          wert={
            <span className="text-[19px]">
              {STATUS_TEXT[(company?.status as string) ?? ""] ??
                (company?.status as string) ??
                "—"}
            </span>
          }
          pille={company?.status === "active" ? "schreibt" : "nur lesen"}
          ton={company?.status === "active" ? "gut" : "warn"}
          notiz="steuert das Schreibrecht des Mandanten"
        />
        <KpiKarte
          label="Plan"
          wert={
            <span className="text-[19px] capitalize">
              {(company?.plan as string) ?? "—"}
            </span>
          }
          notiz="Tarif beim Betreiber"
        />
        <KpiKarte
          label="Plätze"
          wert={(company?.seats as number) ?? 0}
          pille={`${(leute ?? []).length} belegt`}
          ton={
            (leute ?? []).length > ((company?.seats as number) ?? 0)
              ? "kritisch"
              : "neutral"
          }
          notiz="aktive Mitarbeiter"
          href="/mitarbeiter"
        />
      </div>

      {!darfSchreiben ? (
        <p className="mb-4 rounded-input bg-surface px-4 py-3 text-[13px] text-muted shadow-soft">
          Du kannst die Einstellungen sehen, aber nicht ändern.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr] lg:items-start">
        <nav
          aria-label="Bereiche der Einstellungen"
          className="rounded-[20px] bg-surface p-[10px] shadow-soft"
        >
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {BEREICHE.map(([key, label]) => {
              const aktiv = key === bereich;
              return (
                <li key={key} className="shrink-0 lg:shrink">
                  <Link
                    href={`/einstellungen?bereich=${key}`}
                    aria-current={aktiv ? "page" : undefined}
                    className={[
                      "block rounded-input px-[13px] py-[10px] text-[13.5px] whitespace-nowrap transition-colors duration-200 ease-out-quint",
                      aktiv
                        ? "bg-sunk font-semibold text-ink"
                        : "text-muted hover:bg-sunk/60 hover:text-ink",
                    ].join(" ")}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          {bereich === "firma" ? (
            <Abschnitt titel="Firmendaten">
              {darfSchreiben ? (
                <FirmaForm
                  werte={{
                    name: (company?.name as string) ?? "",
                    rechtsform: (company?.rechtsform as string | null) ?? "",
                    address: (company?.address as string | null) ?? "",
                    zip: (company?.zip as string | null) ?? "",
                    city: (company?.city as string | null) ?? "",
                    country: (company?.country as string | null) ?? "",
                    uid_nr: (company?.uid_nr as string | null) ?? "",
                    firmenbuch_nr: (company?.firmenbuch_nr as string | null) ?? "",
                    firmenbuch_gericht:
                      (company?.firmenbuch_gericht as string | null) ?? "",
                    email: (company?.email as string | null) ?? "",
                    phone: (company?.phone as string | null) ?? "",
                    website: (company?.website as string | null) ?? "",
                    iban: (company?.iban as string | null) ?? "",
                    bic: (company?.bic as string | null) ?? "",
                  }}
                />
              ) : (
                <p className="text-[13px] text-muted">
                  Für Einstellungen fehlt deiner Rolle das Schreibrecht.
                </p>
              )}
            </Abschnitt>
          ) : null}

          {bereich === "erscheinungsbild" ? (
            <Abschnitt titel="Erscheinungsbild">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Logo, Farbe und Fusszeile gelten für Mail und PDF gleichermassen.
                Für den Kunden ist eine Mail Post von euch — nicht von der
                Software.
              </p>
              {darfSchreiben ? (
                <MarkeForm
                  firma={(company?.name as string) ?? "Betrieb"}
                  logoUrl={
                    typeof marke.logo_url === "string" ? marke.logo_url : null
                  }
                  akzent={typeof marke.akzent === "string" ? marke.akzent : ""}
                  fusszeile={
                    typeof marke.fusszeile === "string" ? marke.fusszeile : ""
                  }
                />
              ) : (
                <p className="text-[13px] text-muted">
                  Für Einstellungen fehlt deiner Rolle das Schreibrecht.
                </p>
              )}
            </Abschnitt>
          ) : null}

          {bereich === "planer" ? (
            <Abschnitt titel="Planer-Stammdaten">
              <p className="mb-4 max-w-2xl text-[13px] leading-[1.5] text-muted">
                Module, Wechselrichter und Speicher für die Auslegung. Die Werte stammen aus den
                Datenblättern — sie entscheiden, wie viele Module in einen String dürfen, und ein
                geschätzter Wert ist hier schlimmer als eine Lücke.
              </p>
              <PlanerStammdaten
                module={(planerModule ?? []) as unknown as ModulZeile[]}
                wechselrichter={(planerWr ?? []) as unknown as WrZeile[]}
                speicher={(planerSpeicher ?? []) as unknown as SpeicherZeile[]}
                schreibrecht={darfSchreiben}
              />

              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-[15px] font-extrabold">Rechnung und Förderung</h3>
                <p className="mb-4 mt-1 max-w-2xl text-[13px] leading-[1.5] text-muted">
                  Womit die Wirtschaftlichkeit anfängt, bevor im Kundengespräch etwas
                  überschrieben wird.
                </p>
                <PlanerVorgaben
                  vorgabe={(planerVorgabe ?? null) as unknown as VorgabeZeile | null}
                  foerderungen={(planerFoerderung ?? []) as unknown as FoerderZeile[]}
                  schreibrecht={darfSchreiben}
                />
              </div>
            </Abschnitt>
          ) : null}

          {bereich === "checklisten" ? (
            <Abschnitt titel="Aufnahme vor Ort">
              {darfSchreiben ? (
                <ChecklisteForm
                  vorlageId={(checkliste?.id as string | undefined) ?? null}
                  punkte={((checkliste?.punkte ?? []) as unknown as {
                    id: string;
                    label: string;
                    hinweis: string | null;
                    typ: string;
                    pflicht: boolean;
                    sort: number;
                  }[])
                    .slice()
                    .sort((a, b) => a.sort - b.sort)}
                />
              ) : (
                <p className="text-[13px] text-muted">
                  Für Einstellungen fehlt deiner Rolle das Schreibrecht.
                </p>
              )}
            </Abschnitt>
          ) : null}

          {bereich === "einrichtung" ? (
            <Abschnitt titel="Einrichtung">
              <Einrichtung
                abgeschlossen={eingerichtet}
                punkte={einrichtungsPunkte({
                  firma: company,
                  marke,
                  standorte: standorte ?? [],
                  mitarbeiter: (leute ?? []).length,
                  postfaecher: postfaecher ?? [],
                  zaehler: (zaehlerstand ?? []).length,
                  vorgaenge: vorgaenge ?? 0,
                  artikel: artikel ?? 0,
                })}
              />
            </Abschnitt>
          ) : null}

          {bereich === "einrichtung" && unterlagen.length > 0 ? (
            <Abschnitt titel="Was wir von Ihnen brauchen">
              <p className="-mt-1 mb-4 max-w-[62ch] text-[12.5px] leading-[1.5] text-muted">
                Die Liste oben zeigt, was Sie selbst einstellen. Hier steht das
                Gegenteil: die Punkte, bei denen wir auf etwas von Ihnen warten
                — eine Datei, eine Angabe, eine Entscheidung.
              </p>
              <Unterlagen punkte={unterlagen} gesperrt={!darfSchreiben} />
            </Abschnitt>
          ) : null}

          {bereich === "rechte" ? (
            <Abschnitt titel="Rollen und Rechte">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Drei Zustände je Bereich. Was hier steht, gilt überall —
                auch für jemanden, der eine Seite direkt aufruft.
              </p>

              <div className="overflow-x-auto">
                <div className="min-w-[860px]">
                  <div
                    className="grid border-b border-line text-[11px] tracking-[0.07em] text-faint uppercase"
                    style={{
                      gridTemplateColumns: `180px repeat(${ROLES.length}, 1fr)`,
                    }}
                  >
                    <div className="px-[6px] py-[14px]">Bereich</div>
                    {ROLES.map((r) => (
                      <div key={r} className="px-[6px] py-[14px]">
                        {ROLE_LABEL[r] ?? r}
                      </div>
                    ))}
                  </div>

                  {AREAS.map(([area, label]) => (
                    <div
                      key={area}
                      className="grid items-center border-b border-line last:border-b-0"
                      style={{
                        gridTemplateColumns: `180px repeat(${ROLES.length}, 1fr)`,
                      }}
                    >
                      <div className="px-[6px] py-2 text-[13px] font-medium">
                        {label}
                      </div>
                      {ROLES.map((role) => (
                        <PermissionCell
                          key={`${role}-${area}`}
                          role={role}
                          area={area}
                          level={permMap.get(`${role}:${area}`) ?? "none"}
                          gesperrt={
                            !darfSchreiben ||
                            (role === "gf" && area === "einstellungen")
                          }
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <p className="mt-3 text-[12px] text-faint">
                Das Recht der Geschäftsführung auf Einstellungen ist gesperrt —
                sonst sperrt sich der Betrieb mit einem Klick aus seiner eigenen
                Rechteverwaltung aus.
              </p>
            </Abschnitt>
          ) : null}

          {bereich === "standorte" ? (
            <Abschnitt titel="Standorte und Arbeitszeitregeln">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Diese Werte prüft die Einsatzplanung live. Wird die Ruhezeit
                unterschritten, hält das Warnband die Veröffentlichung an, bis
                jemand bestätigt.
              </p>

              <div className="flex flex-col gap-3">
                {(standorte ?? []).length === 0 ? (
                  <p className="text-[13px] text-muted">
                    Kein Standort angelegt.
                  </p>
                ) : (
                  (standorte ?? []).map((s) => {
                    const regeln = (s.worktime_rules ?? {}) as Record<
                      string,
                      number
                    >;
                    const werte: StandortWerte = {
                      id: s.id as string,
                      name: s.name as string,
                      address: (s.address as string | null) ?? "",
                      zip: (s.zip as string | null) ?? "",
                      city: (s.city as string | null) ?? "",
                      holidayRegion: (s.holiday_region as string) ?? "AT-1",
                      minStaffing: Number(s.min_staffing ?? 4),
                      restHours: Number(regeln.rest_hours ?? 11),
                      maxDaily: Number(regeln.max_daily ?? 10),
                      maxWeekly: Number(regeln.max_weekly ?? 50),
                      breakAfterMin: Number(regeln.break_after_min ?? 360),
                      breakMin: Number(regeln.break_min ?? 30),
                      mitarbeiter: proStandort.get(s.id as string) ?? 0,
                    };
                    return (
                      <div key={werte.id}>
                        <StandortForm
                          standort={werte}
                          gesperrt={!darfSchreiben}
                        />
                        {darfSchreiben && (standorte ?? []).length > 1 ? (
                          <StandortLoeschen standort={werte} />
                        ) : null}
                      </div>
                    );
                  })
                )}

                {darfSchreiben ? <StandortNeu /> : null}
              </div>
            </Abschnitt>
          ) : null}

          {bereich === "betriebsmittel" ? (
            <Abschnitt titel="Fahrzeuge und Lagerorte">
              <p className="-mt-1 mb-4 text-[12.5px] leading-[1.5] text-muted">
                Jedes Fahrzeug ist zugleich ein Lagerort. Was auf den Bus
                gebucht wird, liegt auf dem Bus — der Monteur sieht auf der
                Baustelle, was er dabei hat, und das Hauptlager weiss, was es
                nicht mehr hat.
              </p>

              <div className="flex flex-col gap-3">
                <h3 className="mt-1 text-[13px] font-semibold text-muted">
                  Fahrzeuge
                </h3>
                {(fahrzeuge ?? []).length === 0 ? (
                  <p className="text-[13px] text-muted">Kein Fahrzeug angelegt.</p>
                ) : (
                  (fahrzeuge ?? []).map((f) => {
                    const werte: FahrzeugWerte = {
                      id: f.id as string,
                      name: f.name as string,
                      kennzeichen: (f.kennzeichen as string | null) ?? "",
                      aktiv: f.aktiv !== false,
                    };
                    return (
                      <FahrzeugForm
                        key={werte.id}
                        fahrzeug={werte}
                        gesperrt={!darfSchreiben}
                      />
                    );
                  })
                )}
                {darfSchreiben ? <FahrzeugNeu /> : null}

                <h3 className="mt-4 text-[13px] font-semibold text-muted">
                  Lagerorte ohne Fahrzeug
                </h3>
                {(lagerorte ?? []).map((l) => {
                  const werte: LagerWerte = {
                    id: l.id as string,
                    name: l.name as string,
                    aktiv: l.aktiv !== false,
                  };
                  return (
                    <LagerortForm
                      key={werte.id}
                      lagerort={werte}
                      gesperrt={!darfSchreiben}
                    />
                  );
                })}
                {darfSchreiben ? <LagerortNeu /> : null}
              </div>
            </Abschnitt>
          ) : null}

          {bereich === "nachweise" ? (
            <Abschnitt titel="Qualifikationen und Nachweise">
              <p className="-mt-1 mb-4 max-w-[72ch] text-[12.5px] leading-[1.55] text-muted">
                Was Ihr Betrieb führt. Die Einsatzplanung gleicht diese Einträge
                gegen die benötigten Qualifikationen eines Einsatzes ab. Alles,
                was <b>abläuft</b>, bekommt am Mitarbeiter ein Ablaufdatum und
                steht rechtzeitig im Cockpit unter Handlungsbedarf — ohne
                gültigen Nachweis darf niemand aufs Dach.
              </p>

              <ul className="flex flex-col gap-3">
                {(nachweise ?? []).map((q) => {
                  const schluessel = q.schluessel as string;
                  const werte: NachweisWerte = {
                    id: q.id as string,
                    schluessel,
                    label: q.label as string,
                    nachweis: q.nachweis === true,
                    traeger: (traegerListe ?? []).filter((u) =>
                      ((u.qualifikationen as string[] | null) ?? []).includes(
                        schluessel,
                      ),
                    ).length,
                  };
                  return (
                    <NachweisForm
                      key={werte.id}
                      eintrag={werte}
                      gesperrt={!darfSchreiben}
                    />
                  );
                })}
                {darfSchreiben ? <NachweisNeu /> : null}
              </ul>

              <p className="mt-4 max-w-[72ch] text-[12.5px] leading-[1.55] text-faint">
                Die Bezeichnung lässt sich jederzeit ändern. Der Schlüssel
                darunter bleibt, wie er ist — er steht bei den Mitarbeitern und
                an den Einsätzen, und eine Umbenennung würde jede Zuordnung
                verwaisen lassen, ohne dass es jemand merkt.
              </p>
            </Abschnitt>
          ) : null}

          {bereich === "zeit" ? (
            <Abschnitt titel="Zeiterfassung">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Wie der Betrieb Zeiten erfasst und abrechnet. Die
                Arbeitszeitgrenzen selbst — Ruhezeit und Höchstarbeitszeit —
                stehen unter {"„Standorte“"}: das ist Arbeitsrecht und kann sich
                zwischen zwei Niederlassungen unterscheiden, die Rundung
                nicht.
              </p>
              <ZeitregelnForm
                werte={ausJson(company?.time_settings)}
                gesperrt={!darfSchreiben}
              />
            </Abschnitt>
          ) : null}

          {bereich === "nummernkreise" ? (
            <Abschnitt titel="Nummernkreise">
              <p className="-mt-1 mb-4 max-w-[72ch] text-[12.5px] leading-[1.55] text-muted">
                Format <span className="num">Präfix-Jahr-laufend</span>, je
                Mandant und Jahr eine eigene Reihe. Der Zähler läuft unter einer
                Sperre hoch — zwei gleichzeitig erzeugte Belege können nicht
                dieselbe Nummer bekommen. Die nächste Nummer lässt sich
                anheben, etwa um an die bisherige Nummerierung des Betriebs
                anzuschliessen. Senken geht nicht: Eine zurückgesetzte Reihe
                würde Nummern ein zweites Mal vergeben.
              </p>

              <ul className="flex flex-col gap-2">
                {NUMMERNKREISE.map((k) => {
                  const zeile = (zaehlerstand ?? []).find(
                    (z) => z.kind === k.kind && Number(z.year) === JAHR,
                  );
                  const werte: KreisWerte = {
                    kind: k.kind,
                    label: k.label,
                    praefix: k.praefix,
                    jahr: JAHR,
                    stand: Number(zeile?.value ?? 0),
                  };
                  return (
                    <KreisForm
                      key={k.kind}
                      kreis={werte}
                      gesperrt={!darfSchreiben}
                    />
                  );
                })}
              </ul>

              <p className="mt-4 max-w-[72ch] text-[12.5px] leading-[1.55] text-faint">
                Lücken sind erlaubt und kommen vor: Wird ein Entwurf verworfen,
                verfällt seine Nummer. Ein Duplikat ist nicht erlaubt — deshalb
                wird jede Eingabe gegen den Zählerstand UND gegen die tatsächlich
                vergebenen Nummern geprüft.
              </p>
            </Abschnitt>
          ) : null}

          {bereich === "integrationen" ? (
            <Abschnitt titel="Integrationen">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Status der angebundenen Systeme. Verbunden wird nicht hier,
                sondern im jeweiligen Bereich — eine Anmeldung gehört dorthin,
                wo sie gebraucht wird.
              </p>

              <ul className="flex flex-col gap-2">
                <IntegrationsZeile
                  name="Postfach"
                  zweck="Angebote und Rechnungen versenden, Antworten einlesen"
                  zustand={
                    (postfaecher ?? []).length === 0
                      ? { ton: "warn", text: "nicht eingerichtet" }
                      : (postfaecher ?? []).some((m) => m.status === "ok")
                        ? {
                            ton: "gut",
                            text: `verbunden · ${(postfaecher ?? []).map((m) => m.address as string).join(", ")}`,
                          }
                        : { ton: "kritisch", text: "Zugang fehlerhaft" }
                  }
                />
                <IntegrationsZeile
                  name="Outlook-Kalender"
                  zweck="Termine je Auftrag zweiseitig abgleichen"
                  zustand={{
                    ton: "neutral",
                    text: "je Mitarbeiter im Profil zu verbinden",
                  }}
                />
                <IntegrationsZeile
                  name="Buchhaltungsexport"
                  zweck="Rechnungen nächtlich für die Buchhaltung bereitstellen"
                  zustand={{ ton: "neutral", text: "läuft als Nachtlauf" }}
                />
              </ul>
            </Abschnitt>
          ) : null}

          {bereich === "daten" ? (
            <Abschnitt titel="Daten mitnehmen">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Vollständiger Export als ZIP: eine CSV je Tabelle plus alle
                hinterlegten Dateien. Kein eigenes Format — Steuerberater und
                Nachfolgeanbieter können beide damit umgehen.
              </p>

              {me.role === "gf" ? (
                <a
                  href="/api/export/tenant"
                  className="inline-flex min-h-[44px] items-center rounded-pill border border-line bg-surface px-5 text-sm font-medium text-ink transition-colors hover:bg-sunk hover:text-ink"
                >
                  Export herunterladen
                </a>
              ) : (
                <p className="text-[13px] text-muted">
                  Den vollständigen Export darf nur die Geschäftsführung
                  auslösen — er enthält auch Personal- und Rechnungsdaten.
                </p>
              )}

              <p className="mt-3 text-[12px] text-faint">
                Nicht enthalten: die Zugangsdaten des Postfachs und die Tokens
                der Kundenportale. Beides sind Geheimnisse, die nicht in eine
                Datei gehören, die weitergereicht wird.
              </p>
            </Abschnitt>
          ) : null}
        </div>
      </div>
    </>
  );
}

function IntegrationsZeile({
  name,
  zweck,
  zustand,
}: {
  name: string;
  zweck: string;
  zustand: { ton: "gut" | "warn" | "kritisch" | "neutral"; text: string };
}) {
  const farbe =
    zustand.ton === "gut"
      ? "bg-s-done/12 text-s-done"
      : zustand.ton === "warn"
        ? "bg-accent/14 text-accent-ink"
        : zustand.ton === "kritisch"
          ? "bg-s-crit/12 text-s-crit"
          : "bg-sunk text-muted";

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3">
      <span className="min-w-[160px] flex-1">
        <span className="block text-[13.5px] font-medium">{name}</span>
        <span className="block text-[11.5px] text-faint">{zweck}</span>
      </span>
      <span
        className={`shrink-0 rounded-pill px-[10px] py-[4px] text-[11.5px] font-medium ${farbe}`}
      >
        {zustand.text}
      </span>
    </li>
  );
}

/** Wie viele Einträge hängen an welcher Phase — für die Löschsperre. */

/*
 * Was für einen eingerichteten Betrieb zusammenkommen muss.
 *
 * Bewusst keine Spalte in der Datenbank je Punkt: Der Stand ergibt sich
 * aus dem, was ohnehin dasteht. Ein Haken, den jemand setzen kann, ohne
 * dass das Feld gefüllt ist, wäre schlimmer als keine Liste — er
 * behauptet etwas.
 */
function einrichtungsPunkte(d: {
  firma: Record<string, unknown> | null;
  marke: Record<string, unknown>;
  standorte: Record<string, unknown>[];
  mitarbeiter: number;
  postfaecher: Record<string, unknown>[];
  zaehler: number;
  vorgaenge: number;
  artikel: number;
}): Punkt[] {
  const f = d.firma ?? {};
  const text = (k: string): string =>
    typeof f[k] === "string" ? (f[k] as string).trim() : "";

  const standort = d.standorte[0] as Record<string, unknown> | undefined;
  const standortOrt = standort
    ? [standort.zip, standort.city].filter(Boolean).join(" ")
    : "";
  const postfach = d.postfaecher.find((m) => m.status === "ok");

  return [
    {
      titel: "Firmendaten",
      grund:
        "Firmenwortlaut, Anschrift und UID-Nummer stehen auf jedem Angebot und jeder Rechnung. Ohne UID ist die Rechnung für Ihren Kunden nicht vorsteuerabzugsfähig.",
      erledigt: Boolean(text("name") && text("address") && text("uid_nr")),
      href: "/einstellungen?bereich=firma",
      stand: text("uid_nr") ? `UID ${text("uid_nr")}` : undefined,
    },
    {
      titel: "Bankverbindung",
      grund:
        "Die IBAN steht im Fuss der Rechnung. Fehlt sie, zahlt der Kunde später oder ruft an.",
      erledigt: Boolean(text("iban")),
      href: "/einstellungen?bereich=firma",
      stand: text("iban") || undefined,
    },
    {
      titel: "Logo und Hausfarbe",
      grund:
        "Angebot, Rechnung, Kundenportal und die Mail an den Kunden tragen Ihr Logo, nicht unseres.",
      erledigt: typeof d.marke.logo_url === "string" && d.marke.logo_url !== "",
      href: "/einstellungen?bereich=erscheinungsbild",
    },
    {
      titel: "Standort und Arbeitszeitregeln",
      grund:
        "Ruhezeit, Höchstarbeitszeit und Pausenpflicht hängen am Standort. Die Einsatzplanung prüft dagegen und hält einen Dienstplan an, der sie verletzt.",
      erledigt: Boolean(standort && standortOrt),
      href: "/einstellungen?bereich=standorte",
      stand: standort ? `${standort.name as string}${standortOrt ? `, ${standortOrt}` : ""}` : undefined,
    },
    {
      titel: "Mitarbeiter angelegt",
      grund:
        "Jeder bekommt eine Einladung per Mail und setzt sein Passwort selbst. Ein Passwort, das durch das Büro geht, ist keins.",
      erledigt: d.mitarbeiter > 1,
      href: "/mitarbeiter",
      stand: `${d.mitarbeiter} aktiv`,
    },
    {
      titel: "Rollen und Rechte geprüft",
      grund:
        "Wer sieht Rechnungen, wer sieht Stundenkosten, wer sieht Personalakten. Das wird serverseitig durchgesetzt, nicht nur ausgeblendet.",
      erledigt: d.mitarbeiter > 1,
      href: "/einstellungen?bereich=rechte",
    },
    {
      titel: "Nummernkreise",
      grund:
        "Angebots- und Rechnungsnummern müssen dort weiterlaufen, wo Ihre Buchhaltung steht. Nachträglich umstellen geht nicht ohne Lücke.",
      erledigt: d.zaehler > 0,
      href: "/einstellungen?bereich=nummernkreise",
      stand: d.zaehler > 0 ? `${d.zaehler} Kreise vergeben` : undefined,
    },
    {
      titel: "Postfach verbunden",
      grund:
        "Angebote und Rechnungen gehen aus Ihrer eigenen Adresse raus und landen in Ihrem Gesendet-Ordner. Antworten der Kunden kommen in die Software zurueck.",
      erledigt: Boolean(postfach),
      href: "/einstellungen?bereich=integrationen",
      stand: postfach ? (postfach.address as string) : undefined,
    },
    {
      titel: "Artikelstamm",
      grund:
        "Module, Wechselrichter, Speicher und Kleinmaterial mit Ihren Preisen. Daraus entstehen Angebot, Bedarfsliste und Bestellung.",
      erledigt: d.artikel > 0,
      href: "/material",
      stand: d.artikel > 0 ? `${d.artikel} aktive Artikel` : undefined,
    },
    {
      titel: "Erster Vorgang",
      grund:
        "Ein echter Auftrag von der Anfrage bis zum Angebot. Danach wissen Sie, ob die Einstellungen stimmen — vorher ist es Theorie.",
      erledigt: d.vorgaenge > 0,
      href: "/vorgaenge",
      stand: d.vorgaenge > 0 ? `${d.vorgaenge} angelegt` : undefined,
    },
  ];
}
