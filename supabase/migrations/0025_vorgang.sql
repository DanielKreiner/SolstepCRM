-- =====================================================================
-- 0025 — Der Vorgang
--
-- Bisher war ein Projekt über drei Entitäten verteilt: quote für den
-- Vertrieb, job für die Ausführung, service_ticket für danach. Beim
-- Übergang wurde kopiert, und ab da gab es zwei Wahrheiten mit zwei
-- Nummern. Wer wissen wollte, was aus der Anfrage vom März geworden ist,
-- musste drei Listen durchsuchen.
--
-- Ab hier trägt EIN Datensatz den ganzen Weg: V-2026-0042 ist die
-- Anfrage, das Angebot, der Auftrag und der Rechnungsbezug. Die Nummer
-- bleibt, die Phase wechselt.
--
-- Abweichungen vom Briefing, bewusst:
--
--   tenant_id -> company_id. Die gesamte Mandantentrennung dieses
--   Produkts hängt an company_id: current_company_id(), can(),
--   tenant_writable(), der DO-Loop, der Policies erzeugt, und der
--   Isolationstest. Eine zweite Schreibweise daneben wäre die erste
--   Stelle, an der jemand die falsche erwischt.
--
--   kunden -> customer. Die Tabelle gibt es, sie ist gefüllt und sie
--   hängt an Rechnungen, Portalzugängen und Belegen. Das Briefing sagt
--   selbst: prüfen und migrieren, nicht doppelt anlegen.
--
--   artikel -> article. Dasselbe: 469 Artikel liegen darin.
--
-- Die alten Tabellen bleiben in dieser Migration unangetastet. Sie
-- werden erst entfernt, wenn der Umbau steht und die Daten geprüft sind
-- (Briefing Abschnitt 10, Schritt 8).
-- =====================================================================

-- ------------------------------------------------------------ PHASEN
-- Als Enum und nicht als Stammdaten: die sechs Phasen tragen Automatik
-- (Gates, Kaskade, Terminierung) und sind Teil des Produkts, nicht
-- Geschmackssache des Mandanten. Was der Betrieb selbst einstellt, sind
-- die Gates — dort steckt der Unterschied zwischen zwei Betrieben.
create type vorgang_phase as enum (
  'anfrage', 'aufnahme', 'angebot', 'beauftragt', 'montage', 'abschluss', 'verloren'
);

create type verloren_grund as enum (
  'preis', 'konkurrenz', 'keine_rueckmeldung',
  'nicht_machbar', 'kunde_verschoben', 'sonstiges'
);

create type gate_status as enum ('offen', 'laeuft', 'erledigt', 'nicht_noetig');

-- ----------------------------------------------------------- VORGANG
create table vorgang (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete restrict,
  number text not null,                       -- V-2026-0042
  phase vorgang_phase not null default 'anfrage',

  verloren_grund verloren_grund,
  verloren_notiz text,
  verloren_am timestamptz,

  -- Anlage
  kwp numeric(8,2),
  speicher_kwh numeric(8,2),
  adresse text, plz text, ort text,
  zaehlpunkt text,

  -- Kaufmännisch
  angebotswert_netto numeric(12,2),
  auftragswert_netto numeric(12,2),
  anzahlung_prozent numeric(5,2) not null default 30,

  -- Soll aus dem angenommenen Angebot, Basis für spätere Nachkalkulation.
  -- Die Ist-Erfassung ist nicht Teil dieses Umbaus (Briefing Abschnitt 8) —
  -- die Felder entstehen trotzdem jetzt, weil sie beim Annehmen befüllt
  -- werden und später nicht rückwirkend zu ermitteln sind.
  soll_stunden numeric(8,2),
  soll_materialkosten numeric(12,2),

  zustaendig_user_id uuid references app_user(id),
  wiedervorlage_am date,

  -- Wann die aktuelle Phase begonnen hat. Trägt den Stale-Indikator im
  -- Board; aus den Events zu rechnen wäre bei jedem Kartenrendern ein
  -- zusätzlicher Durchlauf über den ganzen Strom.
  phase_seit timestamptz not null default now(),

  created_at timestamptz not null default now(),
  created_by uuid references app_user(id),
  updated_at timestamptz not null default now(),

  unique (company_id, number),

  -- Verloren ohne Grund gibt es nicht. Ein Betrieb, der nach einem Jahr
  -- wissen will, warum er verliert, hat sonst eine Spalte voller NULL.
  constraint vorgang_verloren_grund_pflicht
    check (phase <> 'verloren' or verloren_grund is not null)
);

create index on vorgang (company_id, phase, phase_seit);
create index on vorgang (company_id, customer_id);
create index on vorgang (company_id, zustaendig_user_id);

comment on table vorgang is
  'Ein Vorgang trägt den ganzen Lebenszyklus von der Anfrage bis zur '
  'Schlussrechnung. Nummer und ID bleiben, nur die Phase wechselt.';

-- ------------------------------------------------------- GATE-VORLAGE
create table gate_template (
  company_id uuid not null references company(id) on delete cascade,
  key text not null,
  label text not null,
  meta text,                                  -- Erklärzeile unter dem Label
  blocking boolean not null default false,
  sort int not null default 0,
  primary key (company_id, key)
);

comment on table gate_template is
  'Je Mandant konfigurierbar. blocking entscheidet, ob ein offenes Gate '
  'die Terminierung anhält.';

-- ------------------------------------------------------------- GATES
create table vorgang_gate (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  key text not null,
  label text not null,
  meta text,
  status gate_status not null default 'offen',
  -- Aus der Vorlage kopiert, nicht verknüpft: ändert der Betrieb später
  -- die Vorlage, verschiebt sich nicht rückwirkend, was einen laufenden
  -- Auftrag blockiert hat.
  blocking boolean not null default false,
  zustaendig_user_id uuid references app_user(id),
  faellig_am date,
  erledigt_am timestamptz,
  sort int not null default 0,
  unique (vorgang_id, key)
);

create index on vorgang_gate (company_id, status);

-- ---------------------------------------------------- AKTIVITÄTSSTROM
create table vorgang_event (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  typ text not null check (typ in (
    'notiz', 'phase_wechsel', 'gate_update', 'dokument', 'email',
    'termin', 'zeit', 'status_override', 'rechnung', 'zahlung'
  )),
  titel text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  dokument_id uuid,                           -- FK weiter unten, Reihenfolge
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);

create index on vorgang_event (vorgang_id, created_at desc);

comment on table vorgang_event is
  'Eine Tabelle für alles Chronologische. Getrennte Verlaufstabellen je '
  'Vorgangsart hätten dieselbe Anzeige aus vier Quellen zusammensetzen '
  'müssen, sortiert nach einem Zeitstempel, den keine davon teilt.';

-- --------------------------------------------------------- DOKUMENTE
create table vorgang_dokument (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  typ text not null check (typ in (
    'angebot', 'ab', 'anzahlungsrechnung', 'schlussrechnung',
    'foerderantrag', 'netzanmeldung', 'uebergabeprotokoll',
    'e_befund', 'materialliste', 'foto', 'sonstiges'
  )),
  version int not null default 1,
  nummer text,                                -- RE-2026-0188 bei Rechnungen
  storage_path text,
  dateiname text not null,
  betrag_netto numeric(12,2),
  betrag_brutto numeric(12,2),
  status text check (status in (
    'entwurf', 'versendet', 'angenommen', 'bezahlt', 'storniert'
  )),
  faellig_am date,
  bezahlt_am date,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  unique (company_id, typ, nummer)
);

create index on vorgang_dokument (vorgang_id, created_at desc);
create index on vorgang_dokument (company_id, typ, status);

alter table vorgang_event
  add constraint vorgang_event_dokument_fk
  foreign key (dokument_id) references vorgang_dokument(id) on delete set null;

-- -------------------------------------------------------- POSITIONEN
create table vorgang_position (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  -- Gehört zu einer Angebotsversion. NULL = aktueller Entwurf, der noch
  -- nicht in einem Dokument festgeschrieben ist.
  dokument_id uuid references vorgang_dokument(id) on delete cascade,
  sort int not null default 0,
  article_id uuid references article(id),
  bezeichnung text not null,
  menge numeric(12,3) not null default 1,
  einheit text not null default 'Stk',
  ep_netto numeric(12,2) not null default 0,
  gp_netto numeric(12,2) generated always as (menge * ep_netto) stored,
  ust_satz numeric(4,2) not null default 20,
  -- Kalkulation: was die Position an Zeit und Einkauf kostet. Beides
  -- fliesst beim Annehmen in die Soll-Werte des Vorgangs.
  kalk_stunden numeric(8,3),
  kalk_ek numeric(12,2),
  -- Material zählt in die Bedarfsliste, Leistung nicht.
  ist_material boolean not null default true,
  bild_url text,
  beschreibung text
);

create index on vorgang_position (vorgang_id, dokument_id, sort);

-- ----------------------------------------------------------- TERMINE
create table vorgang_termin (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  art text not null check (art in ('aufnahme', 'montage', 'service')),
  von timestamptz not null,
  bis timestamptz not null,
  -- Eigene Leute als Verknüpfung, Fremdfirmen als Freitext: ein Sub hat
  -- keinen Zugang zu dieser Software und trotzdem einen Namen.
  sub_text text,
  notiz text,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  check (bis > von)
);

create index on vorgang_termin (company_id, von);

create table vorgang_termin_person (
  termin_id uuid not null references vorgang_termin(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  company_id uuid not null references company(id) on delete cascade,
  primary key (termin_id, user_id)
);

-- ------------------------------------------------------------- ARTIKEL
-- Kalkulationsstunden je Einheit: aus ihnen entsteht soll_stunden beim
-- Annehmen. Ohne sie wäre die Nachkalkulation später nicht nachrüstbar,
-- weil niemand rückwirkend weiss, womit gerechnet wurde.
alter table article
  add column if not exists kalk_stunden_pro_einheit numeric(8,3),
  add column if not exists ist_material boolean not null default true;

comment on column article.kalk_stunden_pro_einheit is
  'Kalkulierte Montagezeit je Einheit. Summiert beim Auftragseingang zu '
  'vorgang.soll_stunden.';

-- ---------------------------------------------------------------- RLS
-- Derselbe Loop wie in 0001: jede Tabelle mit company_id bekommt die
-- vier Grundpolicies. Verschärfungen für Rollen folgen unten.
do $$
declare t text;
begin
  foreach t in array array[
    'vorgang', 'gate_template', 'vorgang_gate', 'vorgang_event',
    'vorgang_dokument', 'vorgang_position', 'vorgang_termin',
    'vorgang_termin_person'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (company_id = public.current_company_id())',
      t || '_sel', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (company_id = public.current_company_id() and public.tenant_writable())',
      t || '_ins', t);
    execute format(
      'create policy %I on %I for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id() and public.tenant_writable())',
      t || '_upd', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (company_id = public.current_company_id())',
      t || '_del', t);
  end loop;
end $$;

-- ------------------------------------------------- ROLLEN-VERSCHÄRFUNG
-- Rechnungsdokumente sieht die Montage gar nicht und die Bauleitung
-- nicht (Briefing Abschnitt 6). Die Grenze sitzt in der Policy und nicht
-- im UI: ein ausgeblendetes Feld ist keine Zugriffsbeschränkung.
drop policy vorgang_dokument_sel on vorgang_dokument;
create policy vorgang_dokument_sel on vorgang_dokument
  for select to authenticated
  using (
    company_id = public.current_company_id()
    and (
      typ not in ('anzahlungsrechnung', 'schlussrechnung')
      or public.can('rechnungen', 'read')
    )
  );

-- Die Montage sieht ihre Vorgänge, aber keine Beträge. Spaltenrechte
-- statt Policy: eine Zeile ganz zu verstecken würde dem Monteur auch die
-- Adresse nehmen, zu der er fahren soll (Lektion aus 0009 — erst das
-- Tabellenrecht entziehen, dann die unbedenklichen Spalten gewähren).
revoke select on vorgang from authenticated;
grant select (
  id, company_id, customer_id, number, phase,
  verloren_grund, verloren_notiz, verloren_am,
  kwp, speicher_kwh, adresse, plz, ort, zaehlpunkt,
  anzahlung_prozent, zustaendig_user_id, wiedervorlage_am,
  phase_seit, created_at, created_by, updated_at
) on vorgang to authenticated;

comment on column vorgang.auftragswert_netto is
  'Kein Spaltenrecht für authenticated — Zugriff über v_vorgang_wert, '
  'das can(pipelines) prüft. Die Montage sieht keine Beträge.';

-- Beträge über eine View, die das Recht prüft. Security Invoker, damit
-- RLS auf vorgang weiter greift.
create or replace view v_vorgang_wert as
select v.id as vorgang_id, v.company_id,
       v.angebotswert_netto, v.auftragswert_netto,
       v.soll_stunden, v.soll_materialkosten
from vorgang v
where public.can('pipelines', 'read');

alter view v_vorgang_wert set (security_invoker = on);

-- Schreiben darf, wer Pipelines schreiben darf.
grant update (
  customer_id, phase, verloren_grund, verloren_notiz, verloren_am,
  kwp, speicher_kwh, adresse, plz, ort, zaehlpunkt,
  angebotswert_netto, auftragswert_netto, anzahlung_prozent,
  soll_stunden, soll_materialkosten,
  zustaendig_user_id, wiedervorlage_am, phase_seit, updated_at
) on vorgang to authenticated;

grant insert on vorgang to authenticated;
grant delete on vorgang to authenticated;

-- ------------------------------------------------------ NUMMERNKREISE
-- next_number() kennt die Arten aus 0001; 'vorgang' kommt dazu und
-- bekommt das Präfix V. Die Zählerzeile legt die Funktion beim ersten
-- Aufruf selbst an — hier ist nichts vorzubereiten.
create or replace function public.next_number(p_company uuid, p_kind text, p_year int default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_year int := coalesce(p_year, extract(year from (now() at time zone 'Europe/Vienna'))::int);
        v_val int;
        v_prefix text := case p_kind
          when 'quote' then 'AN' when 'job' then 'A' when 'invoice' then 'RE'
          when 'ticket' then 'S' when 'purchase_order' then 'B'
          when 'vorgang' then 'V' else 'X' end;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || p_kind || v_year, 0));
  insert into doc_counter(company_id, kind, year, value) values (p_company, p_kind, v_year, 1)
    on conflict (company_id, kind, year) do update set value = doc_counter.value + 1
    returning value into v_val;
  return format('%s-%s-%s', v_prefix, v_year, lpad(v_val::text, 4, '0'));
end $$;

-- --------------------------------------------------- STANDARD-GATES
-- Beim Onboarding eines Mandanten. Für die bestehenden gleich mit.
create or replace function public.seed_gate_templates(p_company uuid)
returns void
language sql
as $$
  insert into gate_template (company_id, key, label, meta, blocking, sort)
  values
    (p_company, 'anzahlung',    'Anzahlung',    'Rechnung gestellt und bezahlt',        true,  1),
    (p_company, 'material',     'Material',     'bestellt, Liefertermin bestätigt',     true,  2),
    (p_company, 'foerderung',   'Förderung',    'EAG-Investitionszuschuss eingereicht', false, 3),
    (p_company, 'netzanmeldung','Netzanmeldung','Netzzugangsantrag, Zählpunkt',         true,  4),
    (p_company, 'geruest',      'Gerüst',       'Gerüst oder Hebebühne organisiert',    false, 5),
    (p_company, 'team',         'Team',         'eigenes Team oder Sub verfügbar',      false, 6)
  on conflict (company_id, key) do nothing;
$$;

do $$
declare c record;
begin
  for c in select id from company loop
    perform public.seed_gate_templates(c.id);
  end loop;
end $$;

-- ------------------------------------------------------------- AUDIT
-- Wie in 0001: der Strom ist die fachliche Historie, audit_log die
-- technische. Beides, weil ein Event löschbar ist und ein Audit nicht.
create trigger vorgang_audit
  after insert or update or delete on vorgang
  for each row execute function public.audit_row();

create trigger vorgang_dokument_audit
  after insert or update or delete on vorgang_dokument
  for each row execute function public.audit_row();
