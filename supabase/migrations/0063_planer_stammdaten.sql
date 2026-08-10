/*
 * Stammdaten des Planers: Module, Wechselrichter, Speicher
 * (Briefing 5.1).
 *
 * Zwei Herkünfte in denselben Tabellen:
 *
 *   company_id gesetzt  → Gerät des Mandanten, frei bearbeitbar
 *   company_id NULL     → gemeinsamer Katalog, für alle lesbar und für
 *                         niemanden änderbar
 *
 * Warum nicht zwei Tabellen: ein String verweist auf ein Modul, und
 * dieser Verweis darf nicht davon abhängen, aus welcher Quelle das
 * Modul stammt. Mit zwei Tabellen bräuchte jede Abfrage eine
 * Fallunterscheidung — und irgendeine würde sie vergessen.
 *
 * Wer ein Katalog-Gerät anpassen will, legt eine Kopie an (`kopie_von`).
 * Der Katalog bleibt damit für alle gleich, und die Anpassung gehört
 * dem Betrieb, der sie gemacht hat.
 */

create table if not exists planer_modul (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references company(id) on delete cascade,
  kopie_von uuid references planer_modul(id) on delete set null,

  hersteller text not null,
  bezeichnung text not null,
  wp numeric(7, 1) not null,

  -- Elektrische Werte bei STC. Ohne sie ist keine Auslegung möglich.
  uoc numeric(6, 2) not null,
  umpp numeric(6, 2) not null,
  isc numeric(6, 2) not null,
  impp numeric(6, 2) not null,
  /*
   * Temperaturkoeffizient der Leerlaufspannung, je Kelvin. NEGATIV,
   * z. B. -0.0025 für -0,25 %/K. Das Vorzeichen ist keine Formsache:
   * mit positivem Wert rechnet die Prüfung die Winterspannung nach
   * unten statt nach oben und lässt zu lange Strings durch.
   */
  tk_uoc numeric(8, 6) not null,

  breite numeric(5, 3) not null,
  hoehe numeric(5, 3) not null,
  gewicht numeric(5, 1),
  bild_url text,
  datenblatt_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint planer_modul_tk_check check (tk_uoc < 0),
  constraint planer_modul_masse_check check (breite > 0 and hoehe > 0),
  constraint planer_modul_spannung_check check (uoc > umpp and umpp > 0)
);

create table if not exists planer_wechselrichter (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references company(id) on delete cascade,
  kopie_von uuid references planer_wechselrichter(id) on delete set null,

  hersteller text not null,
  bezeichnung text not null,

  max_dc numeric(7, 1) not null,
  /*
   * MPP-Tracker als Liste, nicht als Spalten: die Zahl schwankt zwischen
   * 1 und 12, und je Tracker gelten eigene Grenzen.
   *   [{ "uMin": 200, "uMax": 800, "iMax": 26, "maxStrings": 2 }, ...]
   */
  mppt jsonb not null default '[]'::jsonb,
  ac_nenn numeric(7, 2) not null,
  max_dc_leistung numeric(7, 2),
  hybrid boolean not null default false,
  datenblatt_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint planer_wr_dc_check check (max_dc > 0 and ac_nenn > 0),
  constraint planer_wr_mppt_check check (jsonb_array_length(mppt) between 1 and 24)
);

create table if not exists planer_speicher (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references company(id) on delete cascade,
  kopie_von uuid references planer_speicher(id) on delete set null,

  hersteller text not null,
  bezeichnung text not null,
  nutzbar_kwh numeric(6, 2) not null,
  /** Erweiterbar in Stufen dieser Grösse; null = nicht erweiterbar. */
  modulgroesse_kwh numeric(6, 2),
  max_module int,
  /** Wechselrichter, mit denen der Speicher läuft. */
  kompatibel uuid[] not null default '{}',
  datenblatt_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint planer_speicher_kwh_check check (nutzbar_kwh > 0)
);

create index if not exists planer_modul_firma on planer_modul (company_id, hersteller);
create index if not exists planer_wr_firma on planer_wechselrichter (company_id, hersteller);
create index if not exists planer_speicher_firma on planer_speicher (company_id, hersteller);

do $$
declare t text;
begin
  foreach t in array array['planer_modul', 'planer_wechselrichter', 'planer_speicher'] loop
    execute format('create trigger %I_touch before update on %I
      for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------ RLS

alter table planer_modul          enable row level security;
alter table planer_wechselrichter enable row level security;
alter table planer_speicher       enable row level security;

/*
 * Lesen: eigene Geräte UND der gemeinsame Katalog. Schreiben: nur
 * eigene — `company_id is null` fehlt in der with-check-Bedingung
 * bewusst, damit niemand über die Anwendung in den Katalog schreibt.
 */
do $$
declare t text;
begin
  foreach t in array array['planer_modul', 'planer_wechselrichter', 'planer_speicher'] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated
         using ((company_id = public.current_company_id() or company_id is null)
                and public.can(''planer'', ''read''))', t, t);

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

comment on column planer_modul.company_id is
  'NULL = gemeinsamer Katalog: für alle lesbar, für niemanden änderbar. '
  'Anpassen geht über eine Kopie (kopie_von).';
