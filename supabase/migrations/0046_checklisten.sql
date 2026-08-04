/*
 * Checklisten für die Aufnahme vor Ort.
 *
 * Die Machbarkeit entscheidet sich auf dem Dach, nicht im Büro: Zählerart,
 * Dachneigung, Ziegelform, Abstand zum Wechselrichterplatz, Verschattung.
 * Wer das nicht vor Ort abhakt, fährt ein zweites Mal hin — und genau
 * dieser zweite Weg frisst die Marge eines Kleinauftrags.
 *
 * Zwei Ebenen, aus einem Grund: der Betrieb legt seine Liste einmal an
 * (Einstellungen), und im einzelnen Vorgang kommt dazu, was nur dort
 * gilt („Nachbar hat Einwände, Kranstellplatz klären"). Ohne die zweite
 * Ebene tippt der Vertrieb seine Sonderfälle in ein Notizfeld, und die
 * Montage liest es nicht.
 *
 * Die Punkte werden beim Anlegen KOPIERT, nicht verknüpft. Dieselbe
 * Regel wie bei Angebotspositionen: eine später geänderte Vorlage darf
 * eine bereits durchgeführte Aufnahme nicht rückwirkend umschreiben.
 */

-- ------------------------------------------------------------ VORLAGEN

create table if not exists checkliste_vorlage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  name text not null,
  /* Wofür die Liste gilt. Heute nur die Aufnahme, absichtlich offen. */
  art text not null default 'aufnahme',
  sort int not null default 0,
  aktiv boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists checkliste_vorlage_firma on checkliste_vorlage (company_id, art, sort);

create table if not exists checkliste_punkt_vorlage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorlage_id uuid not null references checkliste_vorlage(id) on delete cascade,
  label text not null,
  hinweis text,
  /*
   * Was der Punkt vom Vertrieb verlangt:
   *   haken – nur abhaken
   *   text  – eine Angabe („Zählernummer")
   *   zahl  – ein Messwert („Dachneigung in Grad")
   *   foto  – ein Bild ist Pflicht
   *   datei – ein PDF, etwa der Netzbetreiberbescheid
   */
  typ text not null default 'haken'
    check (typ in ('haken', 'text', 'zahl', 'foto', 'datei')),
  pflicht boolean not null default false,
  sort int not null default 0
);
create index if not exists checkliste_punkt_vorlage_liste on checkliste_punkt_vorlage (vorlage_id, sort);

-- ------------------------------------------------------ AM VORGANG

create table if not exists vorgang_checkliste (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  /* Nur zur Herkunft. Die Vorlage darf verschwinden, die Aufnahme bleibt. */
  vorlage_id uuid references checkliste_vorlage(id) on delete set null,
  name text not null,
  art text not null default 'aufnahme',
  abgeschlossen_am timestamptz,
  abgeschlossen_von uuid references app_user(id),
  created_at timestamptz not null default now()
);
create index if not exists vorgang_checkliste_vorgang on vorgang_checkliste (vorgang_id);

create table if not exists vorgang_checkliste_punkt (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  checkliste_id uuid not null references vorgang_checkliste(id) on delete cascade,
  /* Doppelt geführt, damit Anhänge und Rechteprüfung ohne Join auskommen. */
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  label text not null,
  hinweis text,
  typ text not null default 'haken'
    check (typ in ('haken', 'text', 'zahl', 'foto', 'datei')),
  pflicht boolean not null default false,
  sort int not null default 0,
  /* Eigener Punkt des Vertriebs, nicht aus der Vorlage. */
  eigen boolean not null default false,
  wert_text text,
  wert_zahl numeric(12,3),
  erledigt_am timestamptz,
  erledigt_von uuid references app_user(id),
  created_at timestamptz not null default now()
);
create index if not exists vorgang_checkliste_punkt_liste
  on vorgang_checkliste_punkt (checkliste_id, sort);

/*
 * Anhänge laufen über vorgang_anhang und nicht über eine eigene Tabelle:
 * dort sitzen bereits Prüfung der Dateiart, Grössenbegrenzung und das
 * Entfernen der GPS-Daten aus Fotos (Abschnitt 11). Eine zweite
 * Hochladestrecke wäre eine zweite Stelle, an der das vergessen wird.
 */
alter table vorgang_anhang
  add column if not exists checkliste_punkt_id uuid
    references vorgang_checkliste_punkt(id) on delete cascade;

create index if not exists vorgang_anhang_checkliste
  on vorgang_anhang (checkliste_punkt_id);

-- ------------------------------------------------------------------ RLS

alter table checkliste_vorlage        enable row level security;
alter table checkliste_punkt_vorlage  enable row level security;
alter table vorgang_checkliste        enable row level security;
alter table vorgang_checkliste_punkt  enable row level security;

/*
 * Lesen darf jeder im Mandanten — die Montage muss sehen, was bei der
 * Aufnahme herauskam, sonst war die Aufnahme umsonst.
 */
do $$
declare t text;
begin
  foreach t in array array[
    'checkliste_vorlage', 'checkliste_punkt_vorlage',
    'vorgang_checkliste', 'vorgang_checkliste_punkt'
  ] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = public.current_company_id())', t, t);
  end loop;
end $$;

/*
 * Die Vorlagen gehören in die Einstellungen — wer sie ändert, ändert sie
 * für jede künftige Aufnahme im Betrieb.
 */
do $$
declare t text;
begin
  foreach t in array array['checkliste_vorlage', 'checkliste_punkt_vorlage'] loop
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

/*
 * Ausgefüllt wird sie vom Vertrieb am Vorgang — dasselbe Recht, das auch
 * Phasen und Positionen bewegt.
 */
do $$
declare t text;
begin
  foreach t in array array['vorgang_checkliste', 'vorgang_checkliste_punkt'] loop
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

comment on table vorgang_checkliste_punkt is
  'Ausgefüllte Aufnahme am Vorgang. Punkte werden aus der Vorlage kopiert, '
  'nicht verknüpft — eine spätere Änderung der Vorlage schreibt keine '
  'durchgeführte Aufnahme um.';

-- -------------------------------------------------------------- STANDARD

/*
 * Eine Startliste je Mandant, damit die Funktion nicht als leere Fläche
 * beginnt. Ein Betrieb, der etwas anderes braucht, ändert sie — aber er
 * muss nicht bei null anfangen und selbst darauf kommen, wonach man vor
 * Ort überhaupt schaut.
 */
create or replace function public.seed_checkliste(p_company uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from checkliste_vorlage
   where company_id = p_company and art = 'aufnahme' limit 1;
  if v_id is not null then return v_id; end if;

  insert into checkliste_vorlage (company_id, name, art)
  values (p_company, 'Aufnahme vor Ort', 'aufnahme')
  returning id into v_id;

  insert into checkliste_punkt_vorlage
    (company_id, vorlage_id, label, hinweis, typ, pflicht, sort)
  values
    (p_company, v_id, 'Zählerkasten fotografiert',
     'Ganzer Kasten und Typenschild lesbar.', 'foto', true, 10),
    (p_company, v_id, 'Zählernummer',
     'Steht auf dem Zähler, meist unter dem Barcode.', 'text', true, 20),
    (p_company, v_id, 'Dachfläche fotografiert',
     'Von unten und, wenn möglich, vom Dach aus.', 'foto', true, 30),
    (p_company, v_id, 'Dachneigung in Grad', null, 'zahl', false, 40),
    (p_company, v_id, 'Ziegelart', 'Für die Dachhaken entscheidend.', 'text', true, 50),
    (p_company, v_id, 'Sparrenabstand in cm', null, 'zahl', false, 60),
    (p_company, v_id, 'Verschattung geprüft',
     'Bäume, Kamin, Nachbargebäude, Antenne.', 'haken', true, 70),
    (p_company, v_id, 'Platz für Wechselrichter geklärt',
     'Trocken, frostfrei, belüftet.', 'haken', true, 80),
    (p_company, v_id, 'Kabelweg Dach zu Technikraum in Metern', null, 'zahl', false, 90),
    (p_company, v_id, 'Gerüst nötig',
     'Wenn ja, gehört es als Position ins Angebot.', 'haken', false, 100),
    (p_company, v_id, 'Zufahrt für LKW möglich', null, 'haken', false, 110),
    (p_company, v_id, 'Internetanschluss am Wechselrichterplatz',
     'Für die Überwachung.', 'haken', false, 120),
    (p_company, v_id, 'Unterlagen des Netzbetreibers',
     'Zählpunktbezeichnung oder letzte Stromrechnung.', 'datei', false, 130);

  return v_id;
end $$;

revoke execute on function public.seed_checkliste(uuid) from public, anon;

do $$
declare c uuid;
begin
  for c in select id from company loop
    perform public.seed_checkliste(c);
  end loop;
end $$;
