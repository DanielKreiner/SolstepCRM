import type { Metadata } from "next";
import Link from "next/link";
import { Abschnitt } from "@/components/ui/Abschnitt";
import { KpiKarte } from "@/components/ui/KpiKarte";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { ROLE_LABEL } from "@/lib/nav";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  AddPhaseForm,
  PermissionCell,
  PhaseRowForm,
  StandortForm,
  type StandortWerte,
} from "./SettingsForms";

export const metadata: Metadata = { title: "Einstellungen" };

const AREAS = [
  ["pipelines", "Pipelines"],
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

const KIND_LABEL: Record<string, string> = {
  vertrieb: "Vertrieb",
  projekte: "Projekte",
  service: "Service",
};

/*
 * Unternavigation wie in der Vorlage. Der aktive Bereich steht in der URL
 * und nicht im Client-State: ein Link auf die Nummernkreise soll ein Link
 * sein, und nach dem Speichern eines Standorts landet man wieder dort, wo
 * man war.
 */
const BEREICHE = [
  ["rechte", "Rollen und Rechte"],
  ["standorte", "Standorte"],
  ["phasen", "Phasen"],
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

const NUMMERNKREIS_LABEL: Record<string, string> = {
  quote: "Angebote",
  job: "Aufträge",
  invoice: "Rechnungen",
  ticket: "Service-Tickets",
  purchase_order: "Bestellungen",
};

const NUMMERNKREIS_PREFIX: Record<string, string> = {
  quote: "AN",
  job: "A",
  invoice: "RE",
  ticket: "S",
  purchase_order: "B",
};

export default async function EinstellungenPage({
  searchParams,
}: {
  searchParams: Promise<{ bereich?: string }>;
}) {
  const me = await requireMe();
  const supabase = await createClient();
  const { bereich: roh } = await searchParams;

  const bereich: Bereich = BEREICHE.some(([k]) => k === roh)
    ? (roh as Bereich)
    : "rechte";

  const darfSchreiben = me.perms.einstellungen === "write";

  const [
    { data: perms },
    { data: pipelines },
    { data: company },
    { data: standorte },
    { data: leute },
    { data: zaehlerstand },
    { data: postfaecher },
    belegung,
  ] = await Promise.all([
    supabase.from("role_permission").select("role, area, level"),
    supabase
      .from("pipeline")
      .select(
        "id, kind, name, sort, phasen:pipeline_phase ( id, key, label, sort, system_key, is_final )",
      )
      .order("sort"),
    supabase
      .from("company")
      .select(
        "name, uid_nr, address, zip, city, country, iban, status, plan, seats",
      )
      .maybeSingle(),
    supabase
      .from("location")
      .select("id, name, holiday_region, min_staffing, worktime_rules")
      .order("name"),
    supabase.from("app_user").select("id, location_id").eq("active", true),
    supabase
      .from("doc_counter")
      .select("kind, year, value")
      .order("year", { ascending: false }),
    supabase
      .from("v_mail_account")
      .select("id, address, provider, status, last_sync_at, is_default"),
    phasenBelegung(),
  ]);

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
        subtitle="Rollen, Standorte, Phasen, Nummernkreise, Integrationen."
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
          {bereich === "rechte" ? (
            <Abschnitt titel="Rollen und Rechte">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Drei Zustände je Bereich. Durchgesetzt wird das in der Datenbank
                über <span className="num">can()</span> — die Navigation blendet
                nur zusätzlich aus.
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
                      <StandortForm
                        key={werte.id}
                        standort={werte}
                        gesperrt={!darfSchreiben}
                      />
                    );
                  })
                )}
              </div>
            </Abschnitt>
          ) : null}

          {bereich === "phasen" ? (
            <Abschnitt titel="Phasen">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Jeder Betrieb arbeitet anders. Phasen mit Systembedeutung tragen
                Automatiken und lassen sich umbenennen, aber nicht löschen.
              </p>

              <div className="flex flex-col gap-6">
                {(pipelines ?? []).map((p) => {
                  const phasen = (
                    (p.phasen ?? []) as unknown as {
                      id: string;
                      key: string;
                      label: string;
                      sort: number;
                      system_key: string | null;
                      is_final: boolean;
                    }[]
                  ).sort((a, b) => a.sort - b.sort);

                  const naechste = Math.max(0, ...phasen.map((ph) => ph.sort)) + 1;

                  return (
                    <div key={p.id as string}>
                      <h3 className="mb-2 text-[13.5px] font-semibold">
                        {KIND_LABEL[p.kind as string] ?? (p.name as string)}
                      </h3>

                      <ul className="flex flex-col gap-2">
                        {phasen.map((ph) => (
                          <li key={ph.id} className="rounded-input bg-panel px-4 py-3">
                            {darfSchreiben ? (
                              <PhaseRowForm
                                phaseId={ph.id}
                                label={ph.label}
                                systemKey={ph.system_key}
                                belegt={belegung.get(ph.id) ?? 0}
                              />
                            ) : (
                              <div className="flex flex-wrap items-center gap-3">
                                <span className="text-[13px]">{ph.label}</span>
                                {ph.system_key ? (
                                  <span className="num rounded-pill bg-s-warn/12 px-[9px] py-[3px] text-[11px] text-accent-ink">
                                    {ph.system_key}
                                  </span>
                                ) : null}
                                <span className="num text-[11.5px] text-faint">
                                  {belegung.get(ph.id) ?? 0} Einträge
                                </span>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>

                      {darfSchreiben ? (
                        <AddPhaseForm
                          pipelineId={p.id as string}
                          naechsteSortierung={naechste}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Abschnitt>
          ) : null}

          {bereich === "nummernkreise" ? (
            <Abschnitt titel="Nummernkreise">
              <p className="-mt-1 mb-4 text-[12.5px] text-muted">
                Format <span className="num">Präfix-Jahr-laufend</span>, je
                Mandant und Jahr eine eigene Reihe. Der Zähler wird unter einer
                Sperre hochgezählt — zwei gleichzeitige Angebote können nicht
                dieselbe Nummer bekommen. Bewusst nicht editierbar: eine
                zurückgesetzte Reihe erzeugt doppelte Belegnummern.
              </p>

              {(zaehlerstand ?? []).length === 0 ? (
                <p className="text-[13px] text-muted">
                  Noch keine Nummer vergeben.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {(zaehlerstand ?? []).map((z) => {
                    const kind = z.kind as string;
                    const jahr = z.year as number;
                    const wert = z.value as number;
                    return (
                      <li
                        key={`${kind}-${jahr}`}
                        className="flex flex-wrap items-center gap-3 rounded-input bg-panel px-4 py-3"
                      >
                        <span className="min-w-[140px] flex-1 text-[13px] font-medium">
                          {NUMMERNKREIS_LABEL[kind] ?? kind}
                        </span>
                        <span className="num text-[12.5px] text-muted">{jahr}</span>
                        <span className="num text-[12.5px] text-faint">
                          zuletzt{" "}
                          {NUMMERNKREIS_PREFIX[kind] ?? "X"}-{jahr}-
                          {String(wert).padStart(4, "0")}
                        </span>
                        <Pill mono>{wert} vergeben</Pill>
                      </li>
                    );
                  })}
                </ul>
              )}
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
                  name="Step-Planer"
                  zweck="Planung importieren und Angebotspositionen erzeugen"
                  zustand={{ ton: "neutral", text: "Import über die Angebote" }}
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
async function phasenBelegung(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const [jobs, quotes, tickets] = await Promise.all([
    supabase.from("job").select("phase_id"),
    supabase.from("quote").select("phase_id"),
    supabase.from("service_ticket").select("phase_id"),
  ]);

  const map = new Map<string, number>();
  for (const liste of [jobs.data, quotes.data, tickets.data]) {
    for (const r of liste ?? []) {
      const id = r.phase_id as string | null;
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
  }
  return map;
}
