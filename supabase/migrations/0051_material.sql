/*
 * Material und Lager — das Datenmodell.
 *
 * Die tragende Entscheidung: BESTAND IST NIEMALS EIN FELD. Es gibt kein
 * „Bestand: 47", das jemand überschreibt. Bestand ist die Summe eines
 * Bewegungsjournals je Artikel und Lagerort. Auch die Inventur ist eine
 * Bewegung — dann weiss man wenigstens, wer wann was korrigiert hat.
 *
 * Zweite Entscheidung: das Fahrzeug ist ein Lagerort. Kabel auf Bus 1
 * sind nicht „weg", sie liegen woanders — und wer sie sucht, findet sie
 * nur, wenn das System den Unterschied kennt.
 *
 * Dritte Entscheidung: drei Artikelarten steuern den Fluss, damit der
 * Monteur nie entscheiden muss. Schrauben und Dübel werden bewusst NICHT
 * gebucht: ein System, das Schraubenzählen verlangt, wird ignoriert —
 * und dann stimmt gar nichts mehr. Die teuren dreissig exakt, der Rest
 * pauschal.
 *
 * article.stock bleibt vorerst stehen (CLAUDE.md 12.a, zwei Schritte).
 * Es ist ab jetzt eine Spiegelspalte, die ein Trigger aus dem Journal
 * fortschreibt, damit die alte Lagerseite bis zu ihrem Umbau weiterläuft.
 * Gelesen wird der Bestand nur noch aus v_bestand.
 */

-- ----------------------------------------------------------- LAGERORTE

create table if not exists lagerort (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  art text not null check (art in ('hauptlager', 'fahrzeug')),
  fahrzeug_id uuid references fahrzeug(id) on delete cascade,
  name text not null,
  aktiv boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  /* Ein Fahrzeug hat genau einen Lagerort, nicht drei. */
  unique (fahrzeug_id)
);
create index if not exists lagerort_firma on lagerort (company_id, aktiv, sort);

comment on table lagerort is
  'Hauptlager und Fahrzeuge. Jeder Ort führt eigenen Bestand über '
  'dasselbe Journal — ein Fahrzeug ist kein Sonderfall, nur ein Ort.';

/*
 * Die Fahrzeug-Inventur braucht einen Takt. Vier Wochen sind der
 * Vorschlag, nicht das Gesetz — jeder Betrieb stellt es selbst ein.
 */
alter table fahrzeug
  add column if not exists inventur_intervall_tage int not null default 28,
  add column if not exists letzte_inventur date;

-- ------------------------------------------------------- ARTIKELARTEN

/*
 * Der Typ entscheidet über den Materialfluss:
 *
 *   stueckliste            Module, Wechselrichter, Speicher, Dachhaken.
 *                          Beladeliste → Haken = Entnahme auf den Vorgang.
 *   vanstock               Kabel, MC4, Schellen. Per Umbuchung aufs
 *                          Fahrzeug, Verbrauchsmeldung je Einsatz.
 *   nicht_bestandsgefuehrt Schrauben, Dübel, Isolierband. Nie gebucht,
 *                          nur als Kleinmaterial-Pauschale kalkuliert.
 */
alter table article
  add column if not exists typ text not null default 'stueckliste'
    check (typ in ('stueckliste', 'vanstock', 'nicht_bestandsgefuehrt')),
  add column if not exists seriennummernpflichtig boolean not null default false,
  add column if not exists ean text,
  /* Ein Paket ist eine Verkaufszeile mit Stückliste dahinter. */
  add column if not exists ist_paket boolean not null default false;

/*
 * Spaltenrecht: article hat Spaltenrechte statt Tabellenrecht. Ohne
 * eigenes GRANT scheitert nicht die Spalte, sondern jede Abfrage, die
 * sie mitliest — dieselbe Falle wie in 0009, 0029, 0041, 0044 und 0050.
 */
grant select (typ, seriennummernpflichtig, ean, ist_paket) on article to authenticated;
grant insert (typ, seriennummernpflichtig, ean, ist_paket) on article to authenticated;
grant update (typ, seriennummernpflichtig, ean, ist_paket) on article to authenticated;

/*
 * Die Stückliste eines Pakets. „PV-Anlage 10 kWp komplett" ist für den
 * Kunden eine Zeile und für die Ausführung fünfundzwanzig Module, ein
 * Wechselrichter und Unterkonstruktion.
 */
create table if not exists artikel_stueckliste (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  paket_id uuid not null references article(id) on delete cascade,
  artikel_id uuid not null references article(id) on delete restrict,
  menge numeric(12,3) not null check (menge > 0),
  sort int not null default 0,
  /* Ein Paket, das sich selbst enthält, wäre eine Endlosschleife. */
  check (paket_id <> artikel_id),
  unique (paket_id, artikel_id)
);
create index if not exists stueckliste_paket on artikel_stueckliste (paket_id, sort);

/* Min und Max je Fahrzeug und Artikel — Grundlage der Nachfüll-Liste. */
create table if not exists vanstock_regel (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  lagerort_id uuid not null references lagerort(id) on delete cascade,
  artikel_id uuid not null references article(id) on delete cascade,
  min_menge numeric(12,3) not null default 0,
  max_menge numeric(12,3),
  unique (lagerort_id, artikel_id)
);

/*
 * Die Artikelnummer des Lieferanten gehört auf die Bestellung — ohne sie
 * sucht der Grosshändler die Position von Hand heraus.
 */
alter table article_supplier
  add column if not exists lieferanten_artikelnummer text;
alter table supplier
  add column if not exists notiz text;

/*
 * Kleinmaterial-Pauschale je Mandant: entweder ein Prozentsatz der
 * Materialsumme oder ein Betrag je kWp. Der dritte Fall ist „gar nicht" —
 * wer Schrauben trotzdem einzeln verkauft, soll das dürfen.
 */
alter table company
  add column if not exists kleinmaterial_modus text not null default 'prozent'
    check (kleinmaterial_modus in ('aus', 'prozent', 'pro_kwp')),
  add column if not exists kleinmaterial_wert numeric(12,2) not null default 3;

grant select (kleinmaterial_modus, kleinmaterial_wert) on company to authenticated;
grant update (kleinmaterial_modus, kleinmaterial_wert) on company to authenticated;

-- ------------------------------------------------ ANGEBOTSPOSITIONSTYP

/*
 * Die Verkaufsebene bekommt drei Typen. Bisher gab es nur das boolean
 * ist_material, das material von leistung trennte — das Paket fehlte.
 *
 * Beide Spalten laufen eine Zeit lang parallel (CLAUDE.md 12.a); ein
 * Trigger hält sie zusammen, damit älterer Code nicht bricht.
 */
alter table vorgang_position
  add column if not exists pos_typ text not null default 'material'
    check (pos_typ in ('material', 'leistung', 'paket'));

update vorgang_position set pos_typ = 'leistung' where ist_material = false;

grant select (pos_typ) on vorgang_position to authenticated;
grant insert (pos_typ) on vorgang_position to authenticated;
grant update (pos_typ) on vorgang_position to authenticated;

create or replace function public.position_typ_spiegeln()
returns trigger language plpgsql as $$
begin
  /*
   * Wer nur eines von beiden setzt, bekommt das andere passend dazu.
   *
   * Beim Einfügen hat ist_material Vorrang, wenn es ausdrücklich false
   * ist: älterer Code kennt pos_typ nicht und bekommt dessen Vorgabe
   * 'material' untergeschoben. Ohne diese Ausnahme würde aus jeder
   * Pauschalposition stillschweigend wieder Material — und damit
   * Bedarf, den niemand bestellt hat.
   */
  if tg_op = 'INSERT' then
    /*
     * Beide Spalten können null ankommen, obwohl sie Vorgaben haben:
     * PostgREST setzt beim Einfügen mehrerer Zeilen alle Schlüssel, die
     * nicht in JEDER Zeile stehen, ausdrücklich auf null — die Vorgabe
     * greift dann nicht. Ohne diese Fälle stirbt jede gemischte
     * Positionsliste an der NOT-NULL-Prüfung.
     */
    if new.pos_typ is null and new.ist_material is null then
      new.pos_typ := 'material';
      new.ist_material := true;
    elsif new.pos_typ is null then
      new.pos_typ := case when new.ist_material then 'material' else 'leistung' end;
    elsif new.ist_material is null then
      new.ist_material := new.pos_typ <> 'leistung';
    elsif new.ist_material = false and new.pos_typ = 'material' then
      new.pos_typ := 'leistung';
    else
      new.ist_material := new.pos_typ <> 'leistung';
    end if;
  elsif new.pos_typ is null then
    /* Eine Änderung, die den Typ nicht nennt, ändert ihn nicht. */
    new.pos_typ := old.pos_typ;
    if new.ist_material is null then
      new.ist_material := old.ist_material;
    elsif new.ist_material is distinct from old.ist_material then
      new.pos_typ := case when new.ist_material then 'material' else 'leistung' end;
    end if;
  elsif new.pos_typ is distinct from old.pos_typ then
    new.ist_material := new.pos_typ <> 'leistung';
  elsif new.ist_material is null then
    new.ist_material := old.ist_material;
  elsif new.ist_material is distinct from old.ist_material then
    new.pos_typ := case when new.ist_material then 'material' else 'leistung' end;
  end if;
  return new;
end $$;

drop trigger if exists vorgang_position_typ on vorgang_position;
create trigger vorgang_position_typ
  before insert or update on vorgang_position
  for each row execute function public.position_typ_spiegeln();

-- --------------------------------------------------- BEWEGUNGSJOURNAL

/*
 * Genau vier Typen, keiner mehr:
 *
 *   wareneingang         Bestand + am Ziel. Ziel ist ein Lagerort ODER
 *                        — bei Direktlieferung — nur der Vorgang: dann
 *                        liegt die Ware auf der Baustelle und kostet
 *                        sofort, ohne je ein Regal gesehen zu haben.
 *   umbuchung            Ort → Ort, kostenneutral
 *   entnahme             Ort −, auf einen Vorgang gebucht. Die einzige
 *                        Bewegung, die Ist-Materialkosten erzeugt.
 *   rueckgabe_korrektur  Rückgabe (entlastet den Vorgang) oder Inventur
 *                        (ohne Vorgang)
 *
 * Der EK wird zum Bewegungszeitpunkt mitgeschrieben. Keine FIFO- oder
 * Durchschnittsbewertung: für einen Handwerksbetrieb ist der Preis von
 * damals die ehrlichere Zahl als ein gleitender Mittelwert, den niemand
 * nachrechnen kann.
 */
create table if not exists lagerbewegung (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  artikel_id uuid not null references article(id) on delete restrict,
  typ text not null check (
    typ in ('wareneingang', 'umbuchung', 'entnahme', 'rueckgabe_korrektur')
  ),
  von_lagerort_id uuid references lagerort(id) on delete restrict,
  nach_lagerort_id uuid references lagerort(id) on delete restrict,
  /* Immer positiv. Die Richtung steckt in den Orten, nicht im Vorzeichen. */
  menge numeric(12,3) not null check (menge > 0),
  /*
   * Eine Rückgabe als negative Entnahme zu buchen wäre verlockend und
   * falsch: sie ist eine eigene Tatsache. Deshalb das Kennzeichen.
   */
  ist_rueckgabe boolean not null default false,
  vorgang_id uuid references vorgang(id) on delete set null,
  einsatz_id uuid references einsatz(id) on delete set null,
  bestellung_id uuid,
  bestellposition_id uuid,
  ek_zum_zeitpunkt numeric(12,2),
  notiz text,
  /* Idempotenz für die Offline-Queue der Monteur-App. */
  client_uuid uuid unique,
  /* Herkunft aus dem alten stock_move — siehe Brückentrigger unten. */
  legacy_move_id uuid,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),

  /*
   * Was zu welchem Typ gehört. Ohne diese Prüfung entstehen Bewegungen
   * ohne Herkunft oder Ziel, und der Bestand eines Ortes wird
   * unberechenbar.
   */
  check (
    (typ = 'wareneingang'
       and (nach_lagerort_id is not null or vorgang_id is not null))
    or (typ = 'umbuchung' and von_lagerort_id is not null
        and nach_lagerort_id is not null and von_lagerort_id <> nach_lagerort_id)
    or (typ = 'entnahme' and von_lagerort_id is not null and vorgang_id is not null)
    or (typ = 'rueckgabe_korrektur'
        and (von_lagerort_id is not null or nach_lagerort_id is not null))
  )
);
create index if not exists lagerbewegung_artikel on lagerbewegung (artikel_id, created_at desc);
create index if not exists lagerbewegung_vorgang on lagerbewegung (vorgang_id);
create index if not exists lagerbewegung_ort
  on lagerbewegung (company_id, von_lagerort_id, nach_lagerort_id);

comment on column lagerbewegung.ek_zum_zeitpunkt is
  'Wird vom Trigger aus dem Artikelstamm gesetzt, nie vom Client. '
  'Kein Leserecht für authenticated — Ausgabe nur über v_lagerbewegung.';

-- --------------------------------------------------------- BEDARFSLISTE

/*
 * Die Ausführungsebene, getrennt von der Verkaufsebene.
 *
 * Einbahnregel: die Kaskade befüllt sie aus dem Angebot vor, danach ist
 * sie frei bearbeitbar — und eine Änderung hier fasst das Angebot NIE
 * an. Mehrbedarf, der verrechnet werden soll, ist eine bewusste
 * Entscheidung des Betriebs und kein Automatismus.
 */
create table if not exists vorgang_bedarf (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  artikel_id uuid references article(id) on delete restrict,
  /* Freitext für alles ohne Stammartikel. */
  bezeichnung text not null,
  menge numeric(12,3) not null check (menge > 0),
  einheit text not null default 'Stk',
  sort int not null default 0,
  /* Woher die Zeile stammt — aus dem Angebot, aus einem Paket, von Hand. */
  herkunft text not null default 'manuell'
    check (herkunft in ('angebot', 'paket', 'manuell')),
  /*
   * Kommissionierung: das Lager stellt bereit, der Monteur übernimmt.
   * Die Übernahme bucht nichts — sie protokolliert nur, dass die Ware
   * das Lager verlassen hat; gebucht hat bereits, wer abgehakt hat.
   */
  bereitgestellt_am timestamptz,
  uebernommen_am timestamptz,
  notiz text,
  created_at timestamptz not null default now()
);
create index if not exists bedarf_vorgang on vorgang_bedarf (vorgang_id, sort);

-- ---------------------------------------------------------- BESTELLUNG

/*
 * Bestellpflicht: es gibt keinen Wareneingang ohne Bestellung. Damit ist
 * jede Ware im Haus rückführbar und die Liste offener Bestellungen
 * vollständig. Für die spontane Abholung beim Grosshändler gibt es den
 * Schnellweg — Bestellung und Wareneingang in einem Schritt, Kennzeichen
 * abholung. Die Regel bleibt gewahrt, ohne Bürokratie im Alltag.
 */
create table if not exists bestellung (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  /* Aus dem Nummernkreis, nie von Hand: next_number(company,'purchase_order'). */
  nummer text,
  lieferant_id uuid references supplier(id) on delete restrict,
  status text not null default 'entwurf'
    check (status in ('entwurf', 'bestellt', 'teilgeliefert', 'geliefert', 'storniert')),
  ziel text not null default 'hauptlager' check (ziel in ('hauptlager', 'baustelle')),
  /* Bei Ziel Baustelle: von wo die Lieferadresse kommt. */
  ziel_vorgang_id uuid references vorgang(id) on delete set null,
  ziel_lagerort_id uuid references lagerort(id) on delete set null,
  abholung boolean not null default false,
  extern_bestellt boolean not null default false,
  wunschtermin date,
  notiz text,
  bestellt_am timestamptz,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  unique (company_id, nummer),
  /* Ziel Baustelle ohne Vorgang hätte keine Adresse. */
  check (ziel = 'hauptlager' or ziel_vorgang_id is not null)
);
create index if not exists bestellung_firma on bestellung (company_id, status, created_at desc);

create table if not exists bestellposition (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  bestellung_id uuid not null references bestellung(id) on delete cascade,
  artikel_id uuid references article(id) on delete restrict,
  bezeichnung text not null,
  menge numeric(12,3) not null check (menge > 0),
  einheit text not null default 'Stk',
  ek_netto numeric(12,2),
  /* Jede Position behält ihren Vorgang — auch in einer Sammelbestellung. */
  vorgang_id uuid references vorgang(id) on delete set null,
  bedarf_id uuid references vorgang_bedarf(id) on delete set null,
  bestaetigter_termin date,
  gelieferte_menge numeric(12,3) not null default 0,
  storniert boolean not null default false,
  sort int not null default 0
);
create index if not exists bestellposition_liste on bestellposition (bestellung_id, sort);
create index if not exists bestellposition_vorgang on bestellposition (vorgang_id);

/*
 * Das Bestell-PDF und das Lieferscheinfoto hängen an der Bestellung.
 * Beides ist Beleg: das PDF für das, was bestellt wurde, das Foto für
 * das, was ankam.
 */
create table if not exists bestellung_dokument (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  bestellung_id uuid not null references bestellung(id) on delete cascade,
  art text not null check (art in ('bestellung', 'lieferschein')),
  storage_path text not null,
  dateiname text,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
create index if not exists bestellung_dokument_liste
  on bestellung_dokument (bestellung_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lagerbewegung_bestellung_fk'
  ) then
    alter table lagerbewegung
      add constraint lagerbewegung_bestellung_fk
      foreign key (bestellung_id) references bestellung(id) on delete set null;
    alter table lagerbewegung
      add constraint lagerbewegung_bestellposition_fk
      foreign key (bestellposition_id) references bestellposition(id) on delete set null;
  end if;
end $$;

-- -------------------------------------------------------- SERIENNUMMERN

/*
 * Hängen am Vorgang, nicht an der Bewegung: gebraucht werden sie für
 * Garantie, Netzbetreibermeldung und Übergabeprotokoll — dort fragt
 * niemand, aus welchem Regal das Gerät kam.
 */
create table if not exists seriennummer (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  artikel_id uuid not null references article(id) on delete restrict,
  nummer text not null,
  bewegung_id uuid references lagerbewegung(id) on delete set null,
  erfasst_von uuid references app_user(id),
  created_at timestamptz not null default now(),
  /* Dieselbe Seriennummer zweimal im Haus heisst: eine davon ist falsch. */
  unique (company_id, artikel_id, nummer)
);
create index if not exists seriennummer_vorgang on seriennummer (vorgang_id);

-- ------------------------------------------------------------ TRIGGER

/*
 * Der EK kommt aus dem Artikelstamm, nicht vom Client. Sonst liefe ein
 * Gerät, das der Monteur abhakt, mit einem beliebigen Preis in die
 * Nachkalkulation.
 */
create or replace function public.bewegung_ek_setzen()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.ek_zum_zeitpunkt is null then
    select purchase_price into new.ek_zum_zeitpunkt
      from article where id = new.artikel_id;
  end if;
  if new.created_by is null then
    /* app_user.id ist die auth-User-ID; ein Cron bucht ohne Person. */
    select id into new.created_by from app_user where id = auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists lagerbewegung_ek on lagerbewegung;
create trigger lagerbewegung_ek
  before insert on lagerbewegung
  for each row execute function public.bewegung_ek_setzen();

/*
 * article.stock als Spiegel fortschreiben, solange die alte Lagerseite
 * noch danach fragt. Bewegungen, die aus stock_move gespiegelt wurden,
 * bleiben aussen vor — dort hat apply_stock_move den Bestand schon
 * angefasst, und zweimal zählen wäre schlimmer als gar nicht.
 */
create or replace function public.bestand_spiegeln()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare delta numeric := 0;
begin
  if new.legacy_move_id is not null then return new; end if;
  if new.nach_lagerort_id is not null then delta := delta + new.menge; end if;
  if new.von_lagerort_id is not null then delta := delta - new.menge; end if;
  if delta <> 0 then
    update article set stock = coalesce(stock, 0) + delta where id = new.artikel_id;
  end if;
  return new;
end $$;

drop trigger if exists lagerbewegung_spiegel on lagerbewegung;
create trigger lagerbewegung_spiegel
  after insert on lagerbewegung
  for each row execute function public.bestand_spiegeln();

/*
 * Solange noch Code in das alte stock_move schreibt, landet dieselbe
 * Bewegung auch im neuen Journal. Ohne diese Brücke driften die beiden
 * Wahrheiten in dem Moment auseinander, in dem jemand die alte Maske
 * benutzt — und ein Bestand, dem man nicht glaubt, ist wertlos.
 */
create or replace function public.stock_move_spiegeln()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare ort uuid;
begin
  select id into ort from lagerort
   where company_id = new.company_id and art = 'hauptlager' limit 1;
  if ort is null then return new; end if;

  insert into lagerbewegung (
    company_id, artikel_id, typ, von_lagerort_id, nach_lagerort_id,
    menge, ist_rueckgabe, vorgang_id, notiz, created_by, created_at,
    legacy_move_id
  ) values (
    new.company_id, new.article_id,
    /*
     * Eine Entnahme ohne Vorgang gibt es im neuen Modell nicht — sie
     * wäre Bestand, der niemandem zugeordnet verschwindet. Die alte
     * Maske erlaubt sie, also wandert sie als Korrektur herüber. Das ist
     * ehrlicher: irgendjemand hat Bestand ausgebucht, ohne zu sagen
     * wofür.
     */
    case
      when new.kind = 'goods_in' then 'wareneingang'
      when new.kind = 'out' and new.vorgang_id is not null then 'entnahme'
      else 'rueckgabe_korrektur' end,
    case when new.kind = 'out' then ort
         when new.kind = 'correction' and new.qty < 0 then ort end,
    case when new.kind in ('goods_in', 'return') then ort
         when new.kind = 'correction' and new.qty > 0 then ort end,
    abs(new.qty), new.kind = 'return', new.vorgang_id, new.note,
    new.user_id, new.created_at, new.id
  );
  return new;
end $$;

drop trigger if exists stock_move_bruecke on stock_move;
create trigger stock_move_bruecke
  after insert on stock_move
  for each row execute function public.stock_move_spiegeln();

/* Das Journal gehört ins Prüfprotokoll — genau wie stock_move. */
drop trigger if exists lagerbewegung_audit on lagerbewegung;
create trigger lagerbewegung_audit
  after insert or update or delete on lagerbewegung
  for each row execute function public.audit_row();

drop trigger if exists bestellung_audit on bestellung;
create trigger bestellung_audit
  after insert or update or delete on bestellung
  for each row execute function public.audit_row();

-- -------------------------------------------------------------- SICHTEN

/*
 * Der Bestand als Sicht. Kein Feld, das jemand überschreiben kann —
 * wer den Bestand ändern will, bucht eine Bewegung.
 */
create or replace view v_bestand
with (security_invoker = on) as
select b.company_id, b.artikel_id, o.id as lagerort_id, o.name as lagerort,
       o.art as lagerort_art, o.fahrzeug_id, sum(b.menge) as menge
  from (
    select company_id, artikel_id, nach_lagerort_id as ort, menge from lagerbewegung
     where nach_lagerort_id is not null
    union all
    select company_id, artikel_id, von_lagerort_id, -menge from lagerbewegung
     where von_lagerort_id is not null
  ) b
  join lagerort o on o.id = b.ort
 group by b.company_id, b.artikel_id, o.id, o.name, o.art, o.fahrzeug_id
having sum(b.menge) <> 0;

comment on view v_bestand is
  'Bestand je Artikel und Lagerort, gerechnet aus dem Journal. '
  'article.stock ist nur noch ein Spiegel und wird nicht mehr gelesen.';

/*
 * Das Journal für die Anzeige — mit maskiertem EK.
 *
 * Ein Spaltenrecht kann nicht nach Rolle unterscheiden, eine Sicht
 * schon. Wer den EK nicht sehen darf, bekommt null statt einer Zahl;
 * die Bewegung selbst bleibt sichtbar, denn wer geladen hat, darf
 * sehen, dass er geladen hat.
 */
create or replace view v_lagerbewegung as
select b.id, b.company_id, b.artikel_id, b.typ, b.von_lagerort_id,
       b.nach_lagerort_id, b.menge, b.ist_rueckgabe, b.vorgang_id,
       b.einsatz_id, b.bestellung_id, b.bestellposition_id, b.notiz,
       b.created_by, b.created_at,
       case when public.can('rechnungen', 'read') or public.can('lager', 'write')
            then b.ek_zum_zeitpunkt end as ek_zum_zeitpunkt
  from lagerbewegung b
 where b.company_id = public.current_company_id();

/*
 * Ist-Materialkosten je Vorgang: Entnahmen minus Rückgaben, bewertet
 * zum EK der Bewegung.
 *
 * Die ganze Sicht hängt am Recht, nicht nur die Spalte — ein Monteur
 * soll nicht einmal die Zeile sehen. Das Lager ebenfalls nicht:
 * Artikelpreise ja, Vorgangskosten nein.
 */
create or replace view v_vorgang_ist_material as
select b.company_id, b.vorgang_id,
       sum(case when b.ist_rueckgabe then -1 else 1 end
           * b.menge * coalesce(b.ek_zum_zeitpunkt, 0)) as ist_kosten
  from lagerbewegung b
 where b.vorgang_id is not null
   and b.typ in ('entnahme', 'rueckgabe_korrektur', 'wareneingang')
   and b.company_id = public.current_company_id()
   and public.can('rechnungen', 'read')
 group by b.company_id, b.vorgang_id;

comment on view v_vorgang_ist_material is
  'Ist-Materialkosten je Vorgang. Nur für Rollen mit Rechnungsrecht — '
  'Bauleitung, Lager und Monteur bekommen keine Zeile.';

-- ------------------------------------------------------------- RECHTE

/*
 * EK-Preise dürfen an den Monteur nicht durchsickern — auch nicht über
 * eine selbstgebaute Abfrage, nicht nur nicht in der Oberfläche. Ein
 * Tabellenrecht deckt alle Spalten ab, deshalb wird es hier durch
 * Spaltenrechte ersetzt, und die Geldspalte fehlt darin.
 *
 * Achtung beim Erweitern: jede neue Spalte braucht ab jetzt ihr eigenes
 * GRANT, sonst scheitert nicht die Spalte, sondern die ganze Abfrage.
 */
revoke select on lagerbewegung from authenticated;
grant select (
  id, company_id, artikel_id, typ, von_lagerort_id, nach_lagerort_id,
  menge, ist_rueckgabe, vorgang_id, einsatz_id, bestellung_id,
  bestellposition_id, notiz, client_uuid, legacy_move_id, created_by, created_at
) on lagerbewegung to authenticated;

revoke insert on lagerbewegung from authenticated;
grant insert (
  id, company_id, artikel_id, typ, von_lagerort_id, nach_lagerort_id,
  menge, ist_rueckgabe, vorgang_id, einsatz_id, bestellung_id,
  bestellposition_id, notiz, client_uuid, created_by
) on lagerbewegung to authenticated;

/* Ein Journal, das man ändern kann, ist keines. */
revoke update, delete on lagerbewegung from authenticated;

revoke select on bestellposition from authenticated;
grant select (
  id, company_id, bestellung_id, artikel_id, bezeichnung, menge, einheit,
  vorgang_id, bedarf_id, bestaetigter_termin, gelieferte_menge, storniert, sort
) on bestellposition to authenticated;

-- ---------------------------------------------------------------- RLS

alter table lagerort            enable row level security;
alter table artikel_stueckliste enable row level security;
alter table vanstock_regel      enable row level security;
alter table lagerbewegung       enable row level security;
alter table vorgang_bedarf      enable row level security;
alter table bestellung          enable row level security;
alter table bestellposition     enable row level security;
alter table bestellung_dokument enable row level security;
alter table seriennummer        enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'lagerort', 'artikel_stueckliste', 'vanstock_regel', 'lagerbewegung',
    'vorgang_bedarf', 'bestellung', 'bestellposition', 'bestellung_dokument',
    'seriennummer'
  ] loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select to authenticated
         using (company_id = public.current_company_id())', t, t);
  end loop;
end $$;

/*
 * Lagerorte, Stücklisten und Van-Stock-Regeln sind Stammdaten des
 * Lagers. Wer das Lager pflegen darf, pflegt sie.
 */
do $$
declare t text;
begin
  foreach t in array array['lagerort', 'artikel_stueckliste', 'vanstock_regel'] loop
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = public.current_company_id()
                and public.can(''lager'', ''write''))
         with check (company_id = public.current_company_id()
                and public.can(''lager'', ''write'')
                and public.tenant_writable())', t, t);
  end loop;
end $$;

/*
 * Wer welche Bewegung buchen darf — die Rollenmatrix des Briefings,
 * ausgedrückt in Rechten, die es schon gibt:
 *
 *   can('lager','write')         → gf, lager
 *   can('rechnungen','write')    → gf, buero
 *   can('pipelines','write')     → gf, buero, bauleitung
 *   can('zeiterfassung','write') → gf, buero, bauleitung, monteur
 *
 * Wareneingang, Umbuchung und Inventur: Lager und Büro, die Bauleitung
 * ausdrücklich nicht. Die einzige Ausnahme für den Monteur ist die
 * Baustellenlieferung, die er vor Ort bestätigt — sie hat keinen
 * Lagerort und geht direkt auf den Vorgang.
 *
 * Entnahme, Rückgabe und Verbrauchsmeldung: wer auf der Baustelle steht
 * oder den Vorgang führt.
 */
drop policy if exists lagerbewegung_insert on lagerbewegung;
create policy lagerbewegung_insert on lagerbewegung
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and (
      /* Umbuchung und Wareneingang ins Lager */
      (typ in ('wareneingang', 'umbuchung')
        and (von_lagerort_id is not null or nach_lagerort_id is not null)
        and (public.can('lager', 'write') or public.can('rechnungen', 'write')))
      /* Baustellenlieferung — bestätigt der, der davorsteht */
      or (typ = 'wareneingang' and nach_lagerort_id is null
        and vorgang_id is not null and public.can('zeiterfassung', 'write'))
      /* Entnahme und Rückgabe */
      or (typ in ('entnahme', 'rueckgabe_korrektur') and vorgang_id is not null
        and (public.can('zeiterfassung', 'write') or public.can('lager', 'write')
             or public.can('pipelines', 'write')))
      /* Inventur ohne Vorgang: Lager, Büro — oder der Monteur am Fahrzeug */
      or (typ = 'rueckgabe_korrektur' and vorgang_id is null
        and (public.can('lager', 'write') or public.can('rechnungen', 'write')
             or (public.can('zeiterfassung', 'write') and exists (
                   select 1 from lagerort o
                    where o.id in (von_lagerort_id, nach_lagerort_id)
                      and o.art = 'fahrzeug'))))
    )
  );

/* Bedarfsliste: wer den Vorgang führt — und das Lager fürs Bereitstellen. */
drop policy if exists vorgang_bedarf_write on vorgang_bedarf;
create policy vorgang_bedarf_write on vorgang_bedarf
  for all to authenticated
  using (
    company_id = public.current_company_id()
    and (public.can('pipelines', 'write') or public.can('lager', 'write'))
  )
  with check (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and (public.can('pipelines', 'write') or public.can('lager', 'write'))
  );

/*
 * Bestellen darf Büro, Geschäftsführung und Bauleitung; das Lager darf
 * schreiben, weil es Wareneingänge und Lieferscheine an der Bestellung
 * vermerkt. Bestellen selbst tut es in der Oberfläche nicht.
 */
do $$
declare t text;
begin
  foreach t in array array['bestellung', 'bestellposition', 'bestellung_dokument'] loop
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = public.current_company_id()
                and (public.can(''pipelines'', ''write'')
                     or public.can(''lager'', ''write'')))
         with check (company_id = public.current_company_id()
                and public.tenant_writable()
                and (public.can(''pipelines'', ''write'')
                     or public.can(''lager'', ''write'')))', t, t);
  end loop;
end $$;

/* Seriennummern erfasst, wer auf der Baustelle steht. */
drop policy if exists seriennummer_write on seriennummer;
create policy seriennummer_write on seriennummer
  for all to authenticated
  using (
    company_id = public.current_company_id()
    and (public.can('pipelines', 'write') or public.can('zeiterfassung', 'write'))
  )
  with check (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and (public.can('pipelines', 'write') or public.can('zeiterfassung', 'write'))
  );

-- -------------------------------------------------------------- SEEDS

/*
 * Ein Hauptlager je Mandant und ein Lagerort je Fahrzeug. Ohne sie hat
 * die erste Bewegung kein Ziel.
 */
do $$
declare c uuid; f record;
begin
  for c in select id from company loop
    if not exists (select 1 from lagerort where company_id = c and art = 'hauptlager') then
      insert into lagerort (company_id, art, name, sort)
      values (c, 'hauptlager', 'Hauptlager', 0);
    end if;

    for f in select id, name from fahrzeug where company_id = c loop
      if not exists (select 1 from lagerort where fahrzeug_id = f.id) then
        insert into lagerort (company_id, art, fahrzeug_id, name, sort)
        values (c, 'fahrzeug', f.id, f.name, 10);
      end if;
    end loop;
  end loop;
end $$;

/*
 * Kleinteile, die niemand zählt, auf den richtigen Typ setzen. Die
 * Erkennung über den Namen ist grob und bewusst konservativ — falsch
 * eingeordnet ist hier schlimmer als gar nicht eingeordnet, deshalb nur
 * eindeutige Fälle. Den Rest stellt der Betrieb selbst um.
 */
update article
   set typ = 'nicht_bestandsgefuehrt'
 where typ = 'stueckliste'
   and (
     name ilike '%schraube%' or name ilike '%dübel%' or name ilike '%duebel%'
     or name ilike '%isolierband%' or name ilike '%kabelbinder%'
   );

update article
   set typ = 'vanstock'
 where typ = 'stueckliste'
   and (name ilike '%kabel%' or name ilike '%mc4%' or name ilike '%schelle%')
   and name not ilike '%kabelbinder%';

update article
   set seriennummernpflichtig = true
 where category in ('Wechselrichter', 'Speicher');

/*
 * Der Altbestand als Eröffnungsbuchung. Erst die alten stock_move-Zeilen
 * ins Journal spiegeln, dann die Differenz zum heutigen article.stock als
 * Korrektur nachziehen — so stimmt der neue Bestand am ersten Tag mit
 * dem überein, was im Regal liegt. Ohne das stünde jeder Artikel morgen
 * auf null, und niemand würde der neuen Zahl mehr glauben.
 */
insert into lagerbewegung (
  company_id, artikel_id, typ, von_lagerort_id, nach_lagerort_id, menge,
  ist_rueckgabe, vorgang_id, notiz, created_by, created_at, legacy_move_id,
  ek_zum_zeitpunkt
)
select m.company_id, m.article_id,
       case m.kind when 'goods_in' then 'wareneingang'
                   when 'out' then 'entnahme'
                   else 'rueckgabe_korrektur' end,
       case when m.kind = 'out' then o.id
            when m.kind = 'correction' and m.qty < 0 then o.id end,
       case when m.kind in ('goods_in', 'return') then o.id
            when m.kind = 'correction' and m.qty > 0 then o.id end,
       abs(m.qty), m.kind = 'return', m.vorgang_id, m.note, m.user_id,
       m.created_at, m.id, a.purchase_price
  from stock_move m
  join lagerort o on o.company_id = m.company_id and o.art = 'hauptlager'
  join article a on a.id = m.article_id
 where m.qty <> 0
   and not exists (select 1 from lagerbewegung b where b.legacy_move_id = m.id);

do $$
declare a record; ort uuid; journal numeric; diff numeric;
begin
  for a in select id, company_id, stock, purchase_price from article where stock is not null loop
    select id into ort from lagerort
     where company_id = a.company_id and art = 'hauptlager' limit 1;
    if ort is null then continue; end if;

    select coalesce(sum(case when nach_lagerort_id = ort then menge else 0 end)
                  - sum(case when von_lagerort_id = ort then menge else 0 end), 0)
      into journal
      from lagerbewegung where artikel_id = a.id;

    diff := a.stock - journal;
    if diff <> 0 then
      insert into lagerbewegung (
        company_id, artikel_id, typ, von_lagerort_id, nach_lagerort_id,
        menge, notiz, ek_zum_zeitpunkt, legacy_move_id
      ) values (
        a.company_id, a.id, 'rueckgabe_korrektur',
        case when diff < 0 then ort end,
        case when diff > 0 then ort end,
        abs(diff), 'Eröffnungsbestand aus dem Altbestand',
        a.purchase_price,
        /*
         * Als Altlast markiert, damit der Spiegeltrigger article.stock
         * nicht noch einmal anfasst — die Zahl dort ist ja der Ausgangs-
         * wert dieser Buchung.
         */
        '00000000-0000-0000-0000-000000000000'
      );
    end if;
  end loop;
end $$;
