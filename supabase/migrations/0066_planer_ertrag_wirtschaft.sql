/*
 * Ertrag und Wirtschaftlichkeit (Briefing 6 und 7).
 *
 * Drei Dinge:
 *   1. ein Cache für die PVGIS-Antworten,
 *   2. die Rechenvorgaben des Betriebs (Verlust, Preisstaffel, Steigerung),
 *   3. die Fördersätze je Region, die der Betrieb selbst pflegt.
 */

-- ------------------------------------------------------- PVGIS-Cache

/*
 * PVGIS ist ein Dienst der EU-Kommission, kostenlos und ohne Schlüssel.
 * Genau deshalb gehört es sich, ihn nicht bei jedem Reglerzug erneut zu
 * fragen: die Einstrahlung an einem Standort ändert sich nicht binnen
 * Wochen.
 *
 * Der Cache ist bewusst mandantenübergreifend (kein company_id): die
 * Sonne scheint für alle Betriebe gleich, und ein Standort enthält für
 * sich genommen keine Geschäftsdaten — die Koordinaten sind auf vier
 * Nachkommastellen gerundet, also auf rund elf Meter, und stehen ohne
 * jeden Bezug zu einem Projekt oder Kunden.
 */
create table if not exists planer_ertrag_cache (
  -- Schlüssel: lat:lon:neigung:azimut:verlust, gerundet.
  schluessel text primary key,

  spezifisch numeric(7, 1) not null,
  -- Zwölf Monatswerte in kWh/kWp, Index 0 = Jänner.
  monate numeric(7, 2)[] not null,

  abgerufen_am timestamptz not null default now(),
  /*
   * 90 Tage laut Briefing. Danach wird neu geholt — PVGIS aktualisiert
   * seine Datensätze gelegentlich, und ein ewiger Cache würde eine
   * Korrektur nie mitbekommen.
   */
  laeuft_ab timestamptz not null default now() + interval '90 days',

  constraint planer_ertrag_cache_monate_check check (array_length(monate, 1) = 12)
);

comment on table planer_ertrag_cache is
  'Gecachte PVGIS-Antworten je Standort und Ausrichtung, 90 Tage gültig. '
  'Mandantenübergreifend: die Einstrahlung ist keine Geschäftsdatei.';

create index if not exists planer_ertrag_cache_ablauf on planer_ertrag_cache (laeuft_ab);

/*
 * Kein RLS-Zugriff für angemeldete Rollen: gelesen und geschrieben wird
 * ausschliesslich vom Route Handler mit dem Service-Key. Der Browser
 * hat hier nichts zu suchen — er bekommt das Ergebnis, nicht die Ablage.
 */
alter table planer_ertrag_cache enable row level security;

-- ------------------------------------------ Rechenvorgaben des Betriebs

/*
 * Was der Betrieb an der Rechnung einstellen darf. Eine Zeile je
 * Mandant; fehlt sie, gelten die Vorgaben aus lib/planer/wirtschaft.ts.
 *
 * Preise stehen bewusst NICHT im Code: was eine Anlage kostet, weiss
 * der Betrieb, nicht der Entwickler.
 */
create table if not exists planer_wirtschaft_vorgabe (
  company_id uuid primary key references company(id) on delete cascade,

  -- Systemverluste in Prozent, gehen so an PVGIS.
  verlust_prozent numeric(4, 1) not null default 14.0,
  -- Strompreissteigerung je Jahr als Faktor, z. B. 0.02 für 2 %.
  steigerung numeric(4, 3) not null default 0.020,

  -- Vorbelegungen für das Kundengespräch, alle überschreibbar.
  strompreis numeric(5, 3) not null default 0.280,
  verguetung numeric(5, 3) not null default 0.080,

  /*
   * Richtpreis-Staffel als [{ab_kwp, eur_pro_kwp}, …]. Gilt die Stufe
   * mit der grössten Untergrenze, die noch passt. Leere Staffel heisst:
   * kein Vorschlag, der Anlagenpreis wird von Hand gesetzt.
   */
  preisstaffel jsonb not null default '[]'::jsonb,
  -- Aufpreis je kWh Speicher, für die Vorbelegung mit Speicher.
  speicher_eur_pro_kwh numeric(7, 2) not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint planer_wirtschaft_verlust_check check (verlust_prozent between 0 and 40),
  constraint planer_wirtschaft_steigerung_check check (steigerung between 0 and 0.2),
  constraint planer_wirtschaft_staffel_check check (jsonb_typeof(preisstaffel) = 'array')
);

comment on table planer_wirtschaft_vorgabe is
  'Rechenvorgaben je Mandant: Systemverlust, Preisstaffel, Strompreis-'
  'steigerung. Fehlt die Zeile, gelten die Vorgaben aus dem Code.';

create trigger planer_wirtschaft_vorgabe_touch before update on planer_wirtschaft_vorgabe
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------- Förderung

/*
 * Fördersätze je Region — vom Betrieb gepflegt, nicht automatisch
 * bezogen (Briefing 7: „keine automatische Förderdatenbank in v1").
 *
 * Das ist Absicht und keine Sparmassnahme: Förderungen ändern sich
 * unterjährig, laufen aus, sind gedeckelt. Ein automatisch gezogener
 * Betrag, der drei Wochen alt ist, steht im Angebot und wird zur
 * Zusage — der handgepflegte Betrag ist ehrlicher.
 */
create table if not exists planer_foerderung (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,

  -- Bundesland oder Region, z. B. 'Oberösterreich', 'Bayern'.
  region text not null,
  betrag numeric(10, 2) not null default 0,
  -- Woher der Betrag stammt und bis wann er gilt, im Klartext.
  hinweis text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (company_id, region),
  constraint planer_foerderung_betrag_check check (betrag >= 0)
);

comment on table planer_foerderung is
  'Fördersätze je Region, vom Betrieb gepflegt. Bewusst keine externe '
  'Förderdatenbank: veraltete Beträge landen sonst im Angebot.';

create trigger planer_foerderung_touch before update on planer_foerderung
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ RLS

alter table planer_wirtschaft_vorgabe enable row level security;
alter table planer_foerderung         enable row level security;

/*
 * Lesen darf, wer den Planer sieht — die Vorgaben stecken in jeder
 * Rechnung, die er anzeigt. Ändern darf nur, wer Einstellungen
 * schreibt: eine verstellte Preisstaffel wirkt auf jedes künftige
 * Angebot.
 */
do $$
declare t text;
begin
  foreach t in array array['planer_wirtschaft_vorgabe', 'planer_foerderung'] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = public.current_company_id()
                and public.can(''planer'', ''read''))', t, t);

    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = public.current_company_id()
                and public.can(''settings'', ''write''))
         with check (company_id = public.current_company_id()
                     and public.can(''settings'', ''write'')
                     and public.tenant_writable())', t, t);
  end loop;
end $$;

-- ------------------------------------------------------- Vorbelegungen

/*
 * Für jeden bestehenden Mandanten eine Vorgabezeile mit einer Staffel,
 * die als Ausgangspunkt taugt: kleine Anlagen kosten je kWp mehr, weil
 * Gerüst, Anfahrt und Anmeldung gleich bleiben.
 */
insert into planer_wirtschaft_vorgabe (company_id, preisstaffel, speicher_eur_pro_kwh)
select id,
       '[{"ab_kwp": 0, "eur_pro_kwp": 1750},
         {"ab_kwp": 10, "eur_pro_kwp": 1450},
         {"ab_kwp": 20, "eur_pro_kwp": 1250},
         {"ab_kwp": 30, "eur_pro_kwp": 1100}]'::jsonb,
       450
from company
on conflict (company_id) do nothing;
