/*
 * Einsatzplanung: der Einsatz als Planungseinheit.
 *
 * Bis hierher hing jede Planung am Auftrag (vorgang_termin). Damit war
 * „Lager aufräumen" oder ein Servicetag ohne Auftrag nicht planbar, ohne
 * einen Scheinvorgang anzulegen. Der Einsatz löst das: ein Block Zeit von
 * einer oder mehreren Personen, der auf einen Vorgang zeigen KANN.
 *
 * Vier Arten:
 *   auftrag  – Aufnahme und Montage, Vorgang Pflicht, Zeiten laufen dorthin
 *   service  – Störung oder Wartung, Vorgang optional
 *   intern   – Lager, Werkstatt, Schulung; nie ein Vorgang
 *   (Abwesenheiten siehe unten — bewusst NICHT als Einsatzart)
 *
 * ------------------------------------------------------------------
 * Abweichung vom Briefing, mit Grund:
 *
 * Das Briefing führt art='abwesenheit' als vierte Einsatzart. Hier
 * bleiben Abwesenheiten in der Tabelle `absence`, und die Plantafel
 * zeigt sie als eigene Blöcke daneben. Der Grund ist nicht Bequemlichkeit:
 * an `absence` hängen Resturlaubsberechnung, Vertretung und der
 * Jahresplaner. Eine zweite Ablage für dieselbe Aussage („Wallner ist
 * nächste Woche nicht da") hiesse, dass Plantafel und Urlaubskonto
 * auseinanderlaufen, sobald jemand nur eine der beiden pflegt.
 *
 * Die fachliche Forderung — Abwesenheiten in DERSELBEN Tafel, sonst ist
 * die Konfliktprüfung wertlos — bleibt vollständig erfüllt: eine Ansicht,
 * eine harte Sperre, eine Wahrheit. Nur die Ablage ist die bestehende.
 * ------------------------------------------------------------------
 */

-- ------------------------------------------------------------ FAHRZEUGE

create table if not exists fahrzeug (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  name text not null,
  kennzeichen text,
  aktiv boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists fahrzeug_firma on fahrzeug (company_id, aktiv, sort);

comment on table fahrzeug is
  'Fahrzeuge als einfache Ressource. Bewusst ohne Kapazitäten, Ladung '
  'oder Routenlogik — das ist ein eigenes Produkt und der falsche Kampf.';

-- ------------------------------------------------------ QUALIFIKATIONEN

create table if not exists qualifikation (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  schluessel text not null,
  label text not null,
  sort int not null default 0,
  unique (company_id, schluessel)
);

/*
 * Am Mitarbeiter als Textfeld-Liste und nicht als Verknüpfungstabelle:
 * es sind drei bis fünf Schlagworte je Person, sie ändern sich selten,
 * und jede Abfrage der Plantafel bräuchte sonst einen weiteren Join.
 */
alter table app_user
  add column if not exists qualifikationen text[] not null default '{}';

grant select (qualifikationen) on app_user to authenticated;

-- --------------------------------------------------------------- EINSATZ

create table if not exists einsatz (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  art text not null check (art in ('auftrag', 'service', 'intern')),
  /*
   * Bei art='auftrag' Pflicht — das erzwingt der Trigger unten. Eine
   * Prüfung in der Spalte ginge nicht, weil sie beim Umhängen eines
   * Einsatzes kurzzeitig verletzt sein darf.
   */
  vorgang_id uuid references vorgang(id) on delete set null,
  titel text,
  von timestamptz not null,
  bis timestamptz not null,
  ganztaegig boolean not null default false,
  fahrzeug_id uuid references fahrzeug(id) on delete set null,
  /* Fremdfirmen als Freitext: ein Sub hat keinen Zugang zu dieser Software. */
  sub_text text,
  notiz text,
  benoetigte_qualifikationen text[] not null default '{}',
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (bis > von)
);
create index if not exists einsatz_firma_zeit on einsatz (company_id, von);
create index if not exists einsatz_vorgang on einsatz (vorgang_id);
create index if not exists einsatz_fahrzeug on einsatz (fahrzeug_id, von);

create table if not exists einsatz_person (
  einsatz_id uuid not null references einsatz(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  company_id uuid not null references company(id) on delete cascade,
  primary key (einsatz_id, user_id)
);
create index if not exists einsatz_person_user on einsatz_person (user_id);

/*
 * Stopps eines Servicetags. Reihenfolge von Hand, Fahrzeit nur angezeigt
 * — keine Optimierung. Ein PV-Betrieb fährt morgens auf eine Baustelle
 * und bleibt den Tag dort; der Servicetag ist die Ausnahme, für die das
 * hier reicht.
 */
create table if not exists einsatz_stopp (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  einsatz_id uuid not null references einsatz(id) on delete cascade,
  sort int not null default 0,
  name text not null,
  adresse text,
  uhrzeit time,
  /* Aus der Directions-API, nur Anzeige. Null heisst: nicht abgefragt. */
  km numeric(7,1),
  fahrzeit_min int
);
create index if not exists einsatz_stopp_liste on einsatz_stopp (einsatz_id, sort);

/*
 * Was am Einsatz passiert ist. Vor allem: überstimmte Warnungen. Ein
 * Override ohne Spur wäre kein Override, sondern ein Klick.
 */
create table if not exists einsatz_event (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  einsatz_id uuid not null references einsatz(id) on delete cascade,
  typ text not null,
  titel text not null,
  body text,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
create index if not exists einsatz_event_liste on einsatz_event (einsatz_id, created_at desc);

/* Die Zeit hängt am Einsatz, der Einsatz am Vorgang. */
alter table time_entry
  add column if not exists einsatz_id uuid references einsatz(id) on delete set null;
create index if not exists time_entry_einsatz on time_entry (einsatz_id);

/*
 * Woher die Zeit kommt. Ohne das lässt sich eine Korrektur später nicht
 * von einer Stempelung unterscheiden.
 */
alter table time_entry
  add column if not exists quelle text not null default 'manuell'
    check (quelle in ('monteur_app', 'manuell', 'korrektur'));

-- ------------------------------------------------------------ TRIGGER

/*
 * art='auftrag' ohne Vorgang wäre ein Montagetermin, der zu nichts
 * gehört — und die Ist-Stunden liefen ins Leere. art='intern' mit
 * Vorgang wäre umgekehrt eine versteckte Auftragszeit.
 */
create or replace function public.einsatz_art_pruefen()
returns trigger language plpgsql as $$
begin
  if new.art = 'auftrag' and new.vorgang_id is null then
    raise exception 'Ein Auftragseinsatz braucht einen Vorgang.';
  end if;
  if new.art = 'intern' and new.vorgang_id is not null then
    raise exception 'Ein interner Einsatz hängt an keinem Vorgang.';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists einsatz_art_pruefen on einsatz;
create trigger einsatz_art_pruefen
  before insert or update on einsatz
  for each row execute function public.einsatz_art_pruefen();

-- ---------------------------------------------------------------- RLS

alter table fahrzeug        enable row level security;
alter table qualifikation   enable row level security;
alter table einsatz         enable row level security;
alter table einsatz_person  enable row level security;
alter table einsatz_stopp   enable row level security;
alter table einsatz_event   enable row level security;

/*
 * Lesen darf jeder im Mandanten. Der Monteur sieht seine eigenen
 * Einsätze über die Oberfläche gefiltert — die Plantafel-Route prüft
 * die Rolle. Beträge stehen hier nicht drin, deshalb ist Lesen
 * unbedenklich; das gilt ausdrücklich NICHT für den Vorgang dahinter,
 * dessen Werte weiter über v_vorgang_wert laufen.
 */
do $$
declare t text;
begin
  foreach t in array array[
    'fahrzeug', 'qualifikation', 'einsatz', 'einsatz_person',
    'einsatz_stopp', 'einsatz_event'
  ] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = public.current_company_id())', t, t);
  end loop;
end $$;

/*
 * Planen darf, wer Vorgänge schreiben darf — Büro, Bauleitung, GF.
 * Monteur und Lager haben auf 'pipelines' kein Schreibrecht und können
 * damit nichts anlegen oder verschieben (Rollenmatrix, Briefing 7).
 */
do $$
declare t text;
begin
  foreach t in array array[
    'einsatz', 'einsatz_person', 'einsatz_stopp', 'einsatz_event'
  ] loop
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = public.current_company_id()
                and public.can(''pipelines'', ''write''))
         with check (company_id = public.current_company_id()
                and public.can(''pipelines'', ''write'')
                and public.tenant_writable())', t, t);
  end loop;
end $$;

/* Fahrzeuge und Qualifikationen sind Stammdaten. */
do $$
declare t text;
begin
  foreach t in array array['fahrzeug', 'qualifikation'] loop
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = public.current_company_id()
                and public.can(''einstellungen'', ''write''))
         with check (company_id = public.current_company_id()
                and public.can(''einstellungen'', ''write'')
                and public.tenant_writable())', t, t);
  end loop;
end $$;

-- ------------------------------------------------- BESTAND ÜBERNEHMEN

/*
 * vorgang_termin wird zum Einsatz. Zwei Schritte nach CLAUDE.md 12.a:
 * hier entstehen die Einsätze, vorgang_termin bleibt vorerst stehen und
 * verschwindet erst, wenn kein Code mehr darauf zeigt.
 */
alter table vorgang_termin
  add column if not exists einsatz_id uuid references einsatz(id) on delete set null;

do $$
declare t record; neu uuid;
begin
  for t in
    select * from vorgang_termin where einsatz_id is null
  loop
    insert into einsatz (
      company_id, art, vorgang_id, titel, von, bis, sub_text, notiz, created_by, created_at
    ) values (
      t.company_id,
      case when t.art = 'service' then 'service' else 'auftrag' end,
      t.vorgang_id,
      initcap(t.art),
      t.von, t.bis, t.sub_text, t.notiz, t.created_by, t.created_at
    ) returning id into neu;

    insert into einsatz_person (einsatz_id, user_id, company_id)
    select neu, p.user_id, p.company_id
      from vorgang_termin_person p
     where p.termin_id = t.id
    on conflict do nothing;

    update vorgang_termin set einsatz_id = neu where id = t.id;
  end loop;
end $$;

-- -------------------------------------------------------------- SEEDS

/*
 * Ohne Fahrzeuge und Qualifikationen ist die Plantafel eine leere
 * Fläche, an der man nichts ausprobieren kann. Nur anlegen, wenn der
 * Mandant noch keine hat — ein zweiter Lauf darf nichts verdoppeln.
 */
do $$
declare c uuid;
begin
  for c in select id from company loop
    if not exists (select 1 from qualifikation where company_id = c) then
      insert into qualifikation (company_id, schluessel, label, sort) values
        (c, 'elektriker',   'Elektrofachkraft', 10),
        (c, 'hoehenarbeit', 'Höhenarbeit',      20),
        (c, 'speicher',     'Speichertechnik',  30),
        (c, 'stapler',      'Staplerschein',    40);
    end if;

    if not exists (select 1 from fahrzeug where company_id = c) then
      insert into fahrzeug (company_id, name, kennzeichen, sort) values
        (c, 'Bus 1',   null, 10),
        (c, 'Bus 2',   null, 20),
        (c, 'Pritsche', null, 30);
    end if;
  end loop;
end $$;
