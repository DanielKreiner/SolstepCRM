/*
 * Der Einrichtungslink: die offenen Startpunkte ohne Anmeldung ausfüllen.
 *
 * Mit 0078 steht die Liste in den Einstellungen. Das setzt voraus, dass
 * die Person, die die Angaben hat, auch einen Zugang hat — und das
 * stimmt oft nicht: Den Kundenstamm exportiert der Steuerberater, den
 * Resturlaub kennt die Lohnverrechnerin, die Freigabe für das Postfach
 * macht die EDV-Betreuung. Keine dieser Personen arbeitet in der
 * Software, und für drei Angaben legt niemand ein Konto an.
 *
 * Deshalb derselbe Weg wie beim Kundenportal (CLAUDE.md 4.3): ein
 * signierter Link. Der Token trägt company_id und Ablauf, in der
 * Datenbank liegt nur sein Hash — wer die Tabelle liest, kann daraus
 * keinen gültigen Link bauen. Widerrufbar, und der Zweckschlüssel ist
 * ein anderer als beim Portal, damit ein Portal-Token hier niemals
 * durchgeht.
 *
 * ACHTUNG, DER UNTERSCHIED ZUM PORTAL: Ein Portal-Token öffnet die Daten
 * EINES Kunden. Dieser Link öffnet die Einrichtungsliste EINES Mandanten
 * — und nichts sonst. Kein Vorgang, kein Kunde, keine Rechnung, kein
 * Mitarbeiter. Was über diesen Link erreichbar ist, steht vollständig in
 * lib/einrichtung/zugang.ts, und dort schränkt jede Abfrage selbst auf
 * company_id ein. Es gibt keine zweite Sicherung, weil es keine Session
 * gibt, an der RLS greifen könnte.
 *
 * Ablauf 30 Tage und nicht 90 wie beim Portal: Die Einrichtung ist nach
 * ein paar Wochen vorbei. Ein Link, der ein Vierteljahr später noch
 * aufgeht, ist nur noch ein Risiko.
 */

create table public.einrichtung_zugang (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company (id) on delete cascade,

  /* Nur der Hash. Der Token selbst wird genau einmal angezeigt. */
  token_hash text not null unique,

  /* Wofür der Link gedacht war — steht in der Liste der Links. */
  zweck text,

  expires_at timestamptz not null,
  revoked_at timestamptz,

  erstellt_von uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now(),

  letzter_zugriff timestamptz,
  zugriffe integer not null default 0,

  /*
   * Rate-Limit nach CLAUDE.md 11: 30 Anfragen je Minute und Token. Das
   * Fenster steht in der Zeile und nicht im Speicher des Servers — auf
   * Vercel läuft jede Anfrage womöglich in einer anderen Instanz, und
   * ein Zähler im Arbeitsspeicher begrenzt dort nichts.
   */
  fenster_start timestamptz,
  fenster_anfragen integer not null default 0
);

comment on table public.einrichtung_zugang is
  'Signierter Link auf die Einrichtungsliste eines Mandanten, ohne '
  'Anmeldung. Nur der Hash des Tokens, Ablauf 30 Tage, widerrufbar '
  '(0079).';

comment on column public.einrichtung_zugang.token_hash is
  'HMAC des Tokens mit dem Zweckschlüssel. Aus diesem Wert lässt sich '
  'kein Link zurückrechnen.';

create index einrichtung_zugang_firma
  on public.einrichtung_zugang (company_id, created_at desc);

/*
 * Wer über den Link geantwortet hat, hat kein Konto — `beantwortet_von`
 * bleibt dort leer. Ohne ein eigenes Kennzeichen sähe das aus wie eine
 * Antwort, die aus dem Nichts kommt. Die Oberfläche schreibt deshalb
 * "über den Link" statt eines Namens.
 */
alter table public.einrichtung_punkt
  add column if not exists beantwortet_extern boolean not null default false;

comment on column public.einrichtung_punkt.beantwortet_extern is
  'true = die Antwort kam über einen Einrichtungslink ohne Anmeldung.';

-- ------------------------------------------------------------------ RLS

alter table public.einrichtung_zugang enable row level security;

/*
 * Gelesen und angelegt wird nur von der Hand, die auch die übrigen
 * Einstellungen pflegt. Der Link ist ein Zugang zu den Daten des
 * Mandanten — wer ihn erzeugen darf, vergibt Zugriff.
 *
 * Der Link selbst arbeitet mit dem Service-Role-Client und kommt an
 * diesen Policies gar nicht vorbei; sie gelten für das Backoffice.
 */
create policy einrichtung_zugang_select on public.einrichtung_zugang
  for select to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('einstellungen', 'read')
  );

create policy einrichtung_zugang_ins on public.einrichtung_zugang
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and public.can('einstellungen', 'write')
  );

create policy einrichtung_zugang_upd on public.einrichtung_zugang
  for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('einstellungen', 'write')
  )
  with check (
    company_id = public.current_company_id()
    and public.can('einstellungen', 'write')
  );

/*
 * Kein Löschen. Ein widerrufener Link soll in der Liste stehen bleiben:
 * Er sagt, dass es ihn gab, wer ihn erzeugt hat und wann er zuletzt
 * benutzt wurde. Verschwindet die Zeile, verschwindet auch die Spur.
 */
