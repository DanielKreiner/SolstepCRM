/*
 * Planer, Stufe 1: Projekte und Kartenschlüssel.
 *
 * Ein Planer-Projekt ist ein versionierbares Dokument (Briefing 9): der
 * Ursprung des lokalen Metersystems plus eine Geometrie-Struktur, die in
 * den folgenden Stufen wächst (Flächen, Hindernisse, Modulgruppen,
 * Strings, Wirtschaftlichkeit). Deshalb EINE jsonb-Spalte statt einem
 * Dutzend Tabellen: gespeichert wird immer der ganze Stand, Autosave
 * schreibt ihn als Ganzes, und ein Schema-Umbau in Stufe 3 kostet keine
 * Migration.
 *
 * Was NICHT in jsonb liegt, sondern als echte Spalte: alles, wonach
 * gesucht, sortiert oder gefiltert wird — Name, Adresse, Ursprung, kWp,
 * Status. Eine Projektliste, die 200 jsonb-Dokumente auspacken muss, um
 * eine Tabelle zu zeichnen, wird nie schnell.
 *
 * Ursprung als lat/lon in numeric, nicht als PostGIS-Geometrie: wir
 * rechnen ausschliesslich im lokalen Metersystem der Anwendung
 * (lib/planer/geo.ts). PostGIS würde eine Abhängigkeit einführen, die
 * ausser diesen zwei Zahlen nichts trägt.
 */

create table if not exists planer_projekt (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,

  name text not null,
  adresse text,

  -- Ursprung des lokalen Metersystems. Jede gespeicherte Geometrie ist
  -- relativ dazu; wird er verschoben, wandert das ganze Projekt mit.
  ursprung_lat numeric(10, 7) not null,
  ursprung_lon numeric(10, 7) not null,

  -- Zuletzt gesehener Bildausschnitt, damit das Projekt dort aufgeht,
  -- wo es verlassen wurde. Reine Bequemlichkeit, keine Fachdaten.
  anbieter text not null default 'basemap',
  zoom numeric(4, 2) not null default 19,

  /*
   * Der eigentliche Planungsstand. Stufe 1 legt nur die Hülle an:
   *   { "version": 1, "flaechen": [], "gruppen": [], "strings": [] }
   * Ab Stufe 2 füllt sie sich. `version` steht drin, damit ein späteres
   * Format am Dokument selbst erkennbar ist und nicht geraten wird.
   */
  plan jsonb not null default '{"version":1,"flaechen":[],"gruppen":[],"strings":[]}'::jsonb,

  -- Drohnenfoto statt Karte (Briefing 2.3). Kalibrierung gehört zum
  -- Bild, nicht zum Plan — deshalb eigene Spalten.
  foto_pfad text,
  foto_meter_pro_pixel numeric(12, 8),

  -- Abgeleitete Kennzahl für die Projektliste. Wird beim Speichern
  -- mitgeschrieben, nicht live aus dem jsonb gerechnet.
  kwp numeric(8, 3) not null default 0,

  -- Vorschaubild der Belegung für die Kartenliste (Briefing 8.3).
  vorschau_pfad text,

  -- 'entwurf' bis zur Übergabe, danach hängt das Projekt am Vorgang.
  status text not null default 'entwurf',
  vorgang_id uuid references vorgang(id) on delete set null,

  erstellt_von uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint planer_projekt_status_check
    check (status in ('entwurf', 'uebergeben')),
  -- Ein Ursprung ausserhalb der Mercator-Grenze bricht jede Kachelrechnung.
  constraint planer_projekt_ursprung_check
    check (ursprung_lat between -85.05112878 and 85.05112878
           and ursprung_lon between -180 and 180)
);

create index if not exists planer_projekt_firma on planer_projekt (company_id, updated_at desc);
create index if not exists planer_projekt_vorgang on planer_projekt (vorgang_id);

comment on column planer_projekt.plan is
  'Vollständiger Planungsstand als Dokument. Geometrien in METERN, '
  'relativ zu ursprung_lat/ursprung_lon — nie in Pixeln.';
comment on column planer_projekt.foto_meter_pro_pixel is
  'Kalibrierfaktor des Drohnenfotos: wie viele Meter ein Bildpunkt des '
  'hochgeladenen Fotos abdeckt. Null = nicht kalibriert.';

create trigger planer_projekt_touch before update on planer_projekt
  for each row execute function public.touch_updated_at();

/*
 * Kartenschlüssel je Mandant.
 *
 * Eigene Tabelle statt einer Spalte in `company`: auf `company` darf
 * jede angemeldete Rolle lesen (company_select in 0001). Ein Schlüssel
 * dort wäre für Monteur und Lager mitlesbar. Hier gilt stattdessen das
 * Einstellungsrecht — und ausgeliefert wird er ohnehin nie an den
 * Browser, die Kacheln laufen über einen serverseitigen Proxy.
 */
create table if not exists planer_kartenschluessel (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  anbieter text not null,
  schluessel text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (company_id, anbieter),
  constraint planer_schluessel_anbieter_check
    check (anbieter in ('google', 'azure', 'apple'))
);

comment on table planer_kartenschluessel is
  'API-Schlüssel der Kartenanbieter. Verlässt den Server nie — der '
  'Kachel-Proxy setzt ihn serverseitig ein.';

create trigger planer_kartenschluessel_touch before update on planer_kartenschluessel
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ RLS

alter table planer_projekt          enable row level security;
alter table planer_kartenschluessel enable row level security;

/*
 * Lesen darf, wer Vorgänge lesen darf. Der Planer hängt fachlich am
 * Vorgang: aus einer Planung wird eine Anfrage. Monteur und Lager haben
 * auf 'pipelines' kein Leserecht und sehen den Planer damit gar nicht —
 * weder Route noch Navigationspunkt (Briefing 10).
 */
drop policy if exists planer_projekt_select on planer_projekt;
create policy planer_projekt_select on planer_projekt for select to authenticated
  using (company_id = public.current_company_id()
         and public.can('pipelines', 'read'));

drop policy if exists planer_projekt_write on planer_projekt;
create policy planer_projekt_write on planer_projekt for all to authenticated
  using (company_id = public.current_company_id()
         and public.can('pipelines', 'write'))
  with check (company_id = public.current_company_id()
              and public.can('pipelines', 'write')
              and public.tenant_writable());

/*
 * Schlüssel sind Einstellungssache: sie kosten Geld, wenn sie abfliessen.
 * Lesen wie Schreiben nur mit 'einstellungen' — Bauleitung plant, aber
 * hinterlegt keine Abrechnungsschlüssel.
 */
drop policy if exists planer_kartenschluessel_select on planer_kartenschluessel;
create policy planer_kartenschluessel_select on planer_kartenschluessel for select to authenticated
  using (company_id = public.current_company_id()
         and public.can('einstellungen', 'read'));

drop policy if exists planer_kartenschluessel_write on planer_kartenschluessel;
create policy planer_kartenschluessel_write on planer_kartenschluessel for all to authenticated
  using (company_id = public.current_company_id()
         and public.can('einstellungen', 'write'))
  with check (company_id = public.current_company_id()
              and public.can('einstellungen', 'write')
              and public.tenant_writable());
