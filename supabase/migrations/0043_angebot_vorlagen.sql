-- =====================================================================
-- 0043 — Angebotsvorlagen und Anlagendaten am Artikel
--
-- Ein Betrieb baut nicht jedes Angebot neu. Es gibt drei, vier
-- Standardpakete — 8 kWp ohne Speicher, 10 kWp mit, Gewerbe — und der
-- Rest sind Mengen. Ohne Vorlage klickt jemand jedes Mal zwölf
-- Positionen zusammen und vergisst beim vierten Mal den
-- Überspannungsschutz.
--
-- Die Vorlage speichert dieselbe Struktur wie das Angebot: Gruppen mit
-- Paketpreis und Positionen mit Menge, Option und Upgrade. Beim Anwenden
-- wird kopiert, nicht verknüpft — eine spätere Änderung an der Vorlage
-- darf ein liegendes Angebot nicht verändern.
-- =====================================================================

create table angebot_vorlage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  name text not null,
  beschreibung text,
  /* Für welche Anlagengrösse gedacht — reine Orientierung beim Auswählen. */
  ziel_kwp numeric(8,2),
  /*
   * Wird bei einem neuen Angebot automatisch geladen. Höchstens eine je
   * Mandant; der Teilindex weiter unten setzt das durch.
   */
  ist_standard boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references app_user(id),
  unique (company_id, name)
);

create unique index angebot_vorlage_ein_standard
  on angebot_vorlage (company_id)
  where ist_standard;

create table angebot_vorlage_gruppe (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorlage_id uuid not null references angebot_vorlage(id) on delete cascade,
  name text not null,
  beschreibung text,
  sort int not null default 0,
  paket_preis numeric(12,2),
  einzelpreise_verstecken boolean not null default false
);

create table angebot_vorlage_position (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorlage_id uuid not null references angebot_vorlage(id) on delete cascade,
  gruppe_id uuid references angebot_vorlage_gruppe(id) on delete set null,
  sort int not null default 0,
  /*
   * Artikel statt Kopie: die Vorlage soll den heutigen Preis ziehen,
   * wenn sie angewendet wird. Eingefroren wird erst im Angebot.
   */
  article_id uuid references article(id) on delete cascade,
  bezeichnung text not null,
  menge numeric(12,3) not null default 1,
  einheit text not null default 'Stk',
  ep_netto numeric(12,2),
  optional boolean not null default false,
  rabatt_prozent numeric(5,2) not null default 0,
  /*
   * Mengen, die sich aus der Modulzahl ergeben, stehen hier als Faktor.
   * 4 heisst: vier Stück je Modul. Beim Anwenden mit der Modulzahl
   * multipliziert, damit niemand 80 Klemmen von Hand einträgt.
   */
  menge_je_modul numeric(8,3),
  upgrade_article_id uuid references article(id),
  upgrade_kategorie text,
  upgrade_aufpreis numeric(12,2),
  upgrade_text text
);

create index on angebot_vorlage_gruppe (vorlage_id, sort);
create index on angebot_vorlage_position (vorlage_id, gruppe_id, sort);

comment on table angebot_vorlage is
  'Standardpaket eines Betriebs. Beim Anwenden werden Positionen und '
  'Gruppen kopiert — eine spätere Änderung an der Vorlage lässt liegende '
  'Angebote unberührt.';

-- ------------------------------------------------ ANLAGE AM ARTIKEL
/*
 * Der Schnellzusammenbau braucht drei Angaben, die bisher nur im
 * Fliesstext der technischen Daten standen und dort nicht rechenbar
 * sind: wie viel Watt ein Modul leistet, wie viel kW ein Wechselrichter
 * kann und wie viel kWh ein Speicher fasst.
 */
alter table article
  add column if not exists modul_wp numeric(8,2),
  add column if not exists wr_kw numeric(8,2),
  add column if not exists speicher_kwh numeric(8,2);

comment on column article.modul_wp is
  'Nennleistung eines PV-Moduls in Watt. Basis für die kWp-Rechnung im '
  'Schnellzusammenbau.';

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'angebot_vorlage', 'angebot_vorlage_gruppe', 'angebot_vorlage_position'
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
