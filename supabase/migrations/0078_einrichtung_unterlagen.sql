/*
 * Was der Betrieb beim Start beisteuern muss.
 *
 * Die Einrichtungs-Checkliste (0012, Oberflaeche in Einrichtung.tsx)
 * zeigt bisher nur, was der Betrieb selbst einstellen kann: Firmendaten,
 * Standorte, Nummernkreise. Daneben gibt es eine zweite Art von offenem
 * Punkt, fuer die es noch keinen Ort gab — die Dinge, die wir vom
 * Betrieb brauchen, um ueberhaupt etwas bauen oder importieren zu
 * koennen: den Kundenstamm als Datei, die Adresse des
 * Steuerberater-Postfachs, den Resturlaub aus der Lohnverrechnung.
 *
 * Bisher lief das per Mail und Telefon. Das hat zwei Folgen, die beide
 * Geld kosten: Niemand weiss, was noch aussteht, und dieselbe Frage wird
 * zweimal gestellt. CLAUDE.md 12.a nennt die Onboarding-Automatisierung
 * deshalb ein wirtschaftliches Kernfeature und kein Komfort — die
 * Akquisitionszeit ist das Problem, nicht der Deckungsbeitrag.
 *
 * Darum eine Liste je Mandant, in der Frage und Antwort beieinander
 * stehen. Der Betrieb fuellt sie in seinen eigenen Einstellungen aus,
 * angemeldet und ohne eigenen Zugangsweg; der Betreiber sieht denselben
 * Bildschirm. Kein Formular ausserhalb der Software, kein zweiter Kanal,
 * keine Datei, die in einem Mailpostfach liegt.
 *
 * EINE Tabelle fuer Frage und Antwort, nicht zwei: Die Punkte werden je
 * Mandant angelegt, es gibt also genau eine Antwort je Frage. Eine
 * zweite Tabelle brauchte einen Join und traegt nichts.
 *
 * Die Punkte sind Stammdaten je Mandant und kein Enum — gleiche
 * Entscheidung wie bei den Pipeline-Phasen (CLAUDE.md 5.1a). Jeder
 * Betrieb bringt anderes mit, und eine zusaetzliche Frage an einen
 * einzelnen Mandanten darf keinen Deploy brauchen.
 */

create table public.einrichtung_punkt (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company (id) on delete cascade,

  /*
   * Stabiler Schluessel. Er steht in Tests und spaeter in Berichten;
   * der Titel darf sich aendern, der Schluessel nicht.
   */
  schluessel text not null,
  bereich text not null,
  sortierung integer not null default 0,

  titel text not null,
  /* Wozu der Punkt gut ist — ein Satz. "Kundenstamm" ist eine Aufgabe,
     "ohne ihn steht die Software leer da" ist ein Grund. */
  grund text,

  art text not null default 'text',
  /* Nur bei art in ('wahl','mehrwahl'). */
  optionen text[],

  /*
   * Zum Start noetig. Als Kennzeichen und nicht als Datum: Das Datum
   * ist bei jedem Mandanten ein anderes, das Kennzeichen gilt immer.
   */
  dringend boolean not null default false,

  wert text,
  anmerkung text,
  status text not null default 'offen',
  beantwortet_am timestamptz,
  beantwortet_von uuid references app_user (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint einrichtung_punkt_schluessel_eindeutig unique (company_id, schluessel),
  constraint einrichtung_punkt_art_check
    check (art in ('text', 'lang', 'wahl', 'mehrwahl', 'datei')),
  constraint einrichtung_punkt_status_check
    check (status in ('offen', 'beantwortet', 'entfaellt')),
  /* Eine Auswahl ohne Optionen waere ein Feld, das niemand ausfuellen kann. */
  constraint einrichtung_punkt_optionen_check
    check (art not in ('wahl', 'mehrwahl') or coalesce(array_length(optionen, 1), 0) > 0)
);

comment on table public.einrichtung_punkt is
  'Offene Punkte beim Start eines Mandanten, die der Betrieb beisteuern '
  'muss — Dateien, Angaben, Entscheidungen. Frage und Antwort in einer '
  'Zeile, weil es je Mandant genau eine Antwort gibt (0078).';

comment on column public.einrichtung_punkt.dringend is
  'true = ohne diesen Punkt kann der Betrieb nicht produktiv starten. '
  'Steuert nur die Darstellung, nichts blockiert dadurch.';

comment on column public.einrichtung_punkt.wert is
  'Die Antwort als Text. Bei art = mehrwahl die gewaehlten Optionen mit '
  'Komma getrennt, bei art = datei leer — dort haengen die Dateien an '
  'einrichtung_datei.';

create index einrichtung_punkt_firma
  on public.einrichtung_punkt (company_id, sortierung);

create trigger einrichtung_punkt_touch
  before update on public.einrichtung_punkt
  for each row execute function public.touch_updated_at();

/*
 * Die Dateien dazu. Eigene Tabelle, weil ein Punkt mehrere haben kann —
 * "je Rechnungsart eine bisherige Rechnung" sind vier Stueck.
 *
 * Gespeichert wird nur der Pfad. Die Datei liegt im Bucket `documents`
 * unter {company_id}/einrichtung/{punkt_id}/{uuid}-{name}, also im
 * Pfadschema aus CLAUDE.md 4.4. Damit greifen die bestehenden
 * Storage-Policies aus 0072 unveraendert: lesbar fuer den Mandanten,
 * schreibbar nur solange er schreiben darf, und weil das zweite Segment
 * nicht 'mitarbeiter' ist, haengt es nicht am Personalrecht.
 */
create table public.einrichtung_datei (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company (id) on delete cascade,
  punkt_id uuid not null references public.einrichtung_punkt (id) on delete cascade,

  dateiname text not null,
  storage_path text not null,
  mime text,
  groesse_bytes bigint,

  hochgeladen_von uuid references app_user (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.einrichtung_datei is
  'Dateien zu einem Einrichtungspunkt. Ablage im Bucket documents unter '
  '{company_id}/einrichtung/{punkt_id}/… (0078).';

create index einrichtung_datei_punkt
  on public.einrichtung_datei (punkt_id, created_at);

-- ------------------------------------------------------------------ RLS

alter table public.einrichtung_punkt enable row level security;
alter table public.einrichtung_datei enable row level security;

/*
 * Die Schleife aus 0001 hat nur die Tabellen von damals erfasst, neue
 * Tabellen brauchen ihre Policies selbst.
 *
 * Lesen darf jeder Angemeldete des Mandanten: Die Liste sagt, was beim
 * Start noch fehlt, und das ist keine vertrauliche Information. Sie
 * enthaelt bewusst keine Personaldaten — der Resturlaub kommt als Datei
 * und nicht als Feld.
 *
 * Schreiben haengt an `einstellungen: write`. Es ist dieselbe Hand, die
 * Firmendaten und Nummernkreise pflegt, und ein Monteur hat hier nichts
 * zu beantworten.
 */
do $$
declare t text;
begin
  foreach t in array array['einrichtung_punkt', 'einrichtung_datei'] loop
    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (company_id = public.current_company_id())', t, t);

    execute format(
      'create policy %I_ins on public.%I for insert to authenticated
         with check (company_id = public.current_company_id()
                     and public.tenant_writable()
                     and public.can(''einstellungen'', ''write''))', t, t);

    execute format(
      'create policy %I_upd on public.%I for update to authenticated
         using (company_id = public.current_company_id()
                and public.can(''einstellungen'', ''write''))
         with check (company_id = public.current_company_id()
                     and public.tenant_writable()
                     and public.can(''einstellungen'', ''write''))', t, t);

    execute format(
      'create policy %I_del on public.%I for delete to authenticated
         using (company_id = public.current_company_id()
                and public.tenant_writable()
                and public.can(''einstellungen'', ''write''))', t, t);
  end loop;
end $$;

-- ------------------------------------------------------- Standardkatalog

/*
 * Der Katalog, mit dem jeder neue Mandant startet. Wie
 * `seed_pipelines(company_id)` beim Onboarding aufgerufen, und
 * idempotent: ein zweiter Aufruf ergaenzt fehlende Punkte und laesst
 * bestehende Antworten unberuehrt.
 *
 * Bewusst allgemein formuliert. Die Fragen stammen aus einem konkreten
 * Onboarding, gelten aber fuer jeden Elektro- und PV-Betrieb — ein
 * Katalog mit dem Lieferanten eines einzelnen Kunden darin waere beim
 * zweiten Mandanten Ballast.
 */
create or replace function public.seed_einrichtung_punkte(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into einrichtung_punkt
    (company_id, schluessel, bereich, sortierung, titel, grund, art, optionen, dringend)
  values
    -- Unterlagen aus dem bisherigen Programm
    (p_company, 'kundenstamm', 'Unterlagen', 10,
     'Kundenstamm',
     'Mit Kundennummer, Adresse, Telefon, Mail und UID. Format egal, die Spalten ordnen wir zu.',
     'datei', null, true),
    (p_company, 'lieferanten', 'Unterlagen', 20,
     'Lieferanten',
     'Mit der Adresse, an die die Bestellung geht.',
     'datei', null, true),
    (p_company, 'artikel', 'Unterlagen', 30,
     'Artikel',
     'Kleinmaterial grob zusammengefasst, die PV-Teile einzeln.',
     'datei', null, true),
    (p_company, 'technische-daten', 'Unterlagen', 40,
     'Technische Daten der PV-Komponenten',
     'Wechselrichter, Module, Speicher. Ohne diese Werte kann die Stringauslegung nicht rechnen.',
     'datei', null, true),
    (p_company, 'lagerbestand', 'Unterlagen', 50,
     'Lagerbestand zum Start',
     'Wenn ohnehin eine Inventur ansteht, reicht deren Liste.',
     'datei', null, false),
    (p_company, 'mitarbeiterliste', 'Unterlagen', 60,
     'Mitarbeiterliste',
     'Name, Mailadresse, Tätigkeit und Wochenstunden. Daraus entstehen die Zugänge.',
     'datei', null, true),
    (p_company, 'laufende-auftraege', 'Unterlagen', 70,
     'Offene Angebote und laufende Aufträge',
     'Alles, was über den Umstellungstag hinausläuft.',
     'datei', null, true),
    (p_company, 'offene-rechnungen', 'Unterlagen', 80,
     'Offene Rechnungen',
     'Unbezahlte mit Datum und Betrag. Ohne sie beginnt das Mahnwesen bei null.',
     'datei', null, true),

    -- Rechnungen
    (p_company, 'rechnung-muster', 'Rechnungen', 110,
     'Je Rechnungsart eine bisherige Rechnung',
     'Daraus übernehmen wir die Pflichttexte im Wortlaut. Am wichtigsten eine Bauleistungsrechnung.',
     'datei', null, true),
    (p_company, 'rechnungsarten', 'Rechnungen', 120,
     'Welche Rechnungsarten kommen vor?',
     'Nur was angekreuzt ist, wird eingebaut und geprüft.',
     'mehrwahl',
     array['20 % Umsatzsteuer', 'Bauleistung § 19', 'Reverse Charge EU',
           'Innergemeinschaftliche Lieferung', '10 oder 13 %', 'Ausfuhr Drittland'],
     true),
    (p_company, 'steuerberater-postfach', 'Rechnungen', 130,
     'Postfach der Steuerberatung',
     'Dort landet künftig jede freigegebene Rechnung automatisch als PDF.',
     'text', null, true),
    (p_company, 'ausgangsbuch', 'Rechnungen', 140,
     'Rechnungsausgangsbuch, ein Monat',
     'Ein Monat reicht. Der Export bekommt dieselben Spalten, dann muss die Steuerberatung nichts umstellen.',
     'datei', null, true),
    (p_company, 'barzahlung', 'Rechnungen', 150,
     'Kommt Barzahlung vor?',
     'Bei Barumsätzen ist die Registrierkasse zu klären. Die ersetzt diese Software nicht.',
     'wahl', array['nein', 'selten', 'ja, regelmäßig'], true),
    (p_company, 'anzahlung-beleg', 'Rechnungen', 160,
     'Anzahlung über Auftragsbestätigung oder über eine Rechnung?',
     'Wird bei jedem Angebot gefragt. Gibt es eine Regel, wird sie vorbelegt.',
     'wahl',
     array['meist Auftragsbestätigung', 'meist Rechnung', 'je Kunde verschieden'], false),

    -- Postfach
    (p_company, 'postfach-admin', 'Postfach', 210,
     'Wer verwaltet das Mailkonto?',
     'Name und Mailadresse. Diese Person gibt die Verbindung einmal frei, oft die EDV-Betreuung.',
     'text', null, true),
    (p_company, 'absenderadresse', 'Postfach', 220,
     'Absenderadresse für Angebote und Rechnungen',
     'Ein gemeinsames Postfach ist besser als ein persönliches: dann sieht das ganze Büro den Verlauf.',
     'text', null, true),

    -- Personal
    (p_company, 'resturlaub', 'Personal', 310,
     'Resturlaub je Mitarbeiter zum Stichtag',
     'Aus der Lohnverrechnung. Bitte angeben, ob Tage oder Stunden.',
     'datei', null, true),
    (p_company, 'urlaubsregel', 'Personal', 320,
     'Wird der Urlaub zum Jahresbeginn gutgeschrieben oder monatlich aufgebaut?',
     'Dazu in der Anmerkung: ob und wann Resturlaub verfällt.',
     'wahl', array['zum Jahresbeginn', 'monatlich', 'noch offen'], true),
    (p_company, 'kollektivvertrag', 'Personal', 330,
     'Welcher Kollektivvertrag gilt?',
     'Grundlage für Zuschläge und Ruhezeiten. Ohne ihn rechnen Überstunden falsch.',
     'text', null, true),

    -- Lager
    (p_company, 'lieferzeiten', 'Lager', 410,
     'Welche Artikel haben lange Lieferzeit, und wie lange?',
     'Daraus entsteht die Erinnerung: Montagetermin minus Lieferzeit. Eine Woche vorher ist bei sechs Wochen Lieferzeit zu spät.',
     'lang', null, false),
    (p_company, 'artikelgruppen', 'Lager', 420,
     'Welche Artikelgruppen wären sinnvoll?',
     'Damit viele ähnliche Artikel einzeln bleiben, eine Regel aber nur einmal gesetzt werden muss.',
     'lang', null, false),
    (p_company, 'lieferanten-ab', 'Lager', 430,
     'Zwei oder drei Auftragsbestätigungen von Lieferanten',
     'Grundlage dafür, dass die Einkaufspreise künftig daraus gelesen werden. So wie sie hereinkommen, gescannt genügt.',
     'datei', null, false),

    -- Befunde
    (p_company, 'pruefbefund', 'Befunde', 510,
     'Prüfbefund, wie er heute verwendet wird',
     'Als PDF oder ausfüllbares Formular. Erst damit lässt sich der Aufwand abschätzen.',
     'datei', null, false),
    (p_company, 'befund-vorbelegt', 'Befunde', 520,
     'Was soll im Prüfbefund schon ausgefüllt sein?',
     'Gedacht ist: Kundendaten und Anlagenadresse aus dem Auftrag, die Komponenten aus der Auftragsbestätigung. Vor Ort bleiben die Messwerte.',
     'lang', null, false),

    -- Rückmeldung
    (p_company, 'aufgefallen', 'Rückmeldung', 610,
     'Was ist beim Arbeiten aufgefallen?',
     'Fehler, Umwege, Felder die fehlen oder anders heißen sollten. Auch Kleinigkeiten.',
     'lang', null, false),
    (p_company, 'zum-start-wichtig', 'Rückmeldung', 620,
     'Was muss zum Start unbedingt funktionieren?',
     'Danach richtet sich die Reihenfolge der Arbeit.',
     'lang', null, false)
  on conflict (company_id, schluessel) do nothing;
end $$;

comment on function public.seed_einrichtung_punkte(uuid) is
  'Legt den Standardkatalog der offenen Startpunkte für einen Mandanten '
  'an. Idempotent: bestehende Punkte und ihre Antworten bleiben.';

/*
 * Bestehende Mandanten bekommen den Katalog sofort. Ohne das waere die
 * Liste genau dort leer, wo sie jetzt gebraucht wird.
 */
do $$
declare c record;
begin
  for c in select id from company loop
    perform public.seed_einrichtung_punkte(c.id);
  end loop;
end $$;
