-- =====================================================================
-- 0041 — Das Angebot bekommt Struktur
--
-- Bisher war ein Angebot eine flache Liste von Positionen. Ein
-- PV-Angebot ist aber keine Liste, sondern ein Paket: "PV-Anlage
-- 9,3 kWp" für 7205,93 €, und darin stecken Module, Montagematerial,
-- Wechselrichter und Speicher — ohne dass der Kunde je den Einzelpreis
-- einer Modulklemme sieht.
--
-- Dazu kommen die drei Dinge, die den Abschluss bewegen: optionale
-- Positionen, die der Kunde ankreuzt; Upgrades, die er statt der
-- Standardposition wählt; und ein Rabatt, der als eigene Zeile steht
-- statt in den Positionen zu verschwinden.
-- =====================================================================

-- ---------------------------------------------------------- GRUPPEN
create table vorgang_gruppe (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  /*
   * Gehört zu einer Angebotsversion — dieselbe Mechanik wie bei den
   * Positionen: NULL ist der Entwurf, ein Dokument die eingefrorene
   * Fassung. Ohne das änderte eine spätere Umgruppierung rückwirkend
   * ein verschicktes Angebot.
   */
  dokument_id uuid references vorgang_dokument(id) on delete cascade,
  name text not null,
  beschreibung text,
  sort int not null default 0,
  /*
   * Pauschalpreis statt Summe. NULL heisst: die Positionen zählen sich
   * selbst zusammen. Gesetzt heisst: der Betrieb hat einen Paketpreis
   * verhandelt, und der gilt — auch wenn die Einzelsumme daneben liegt.
   */
  paket_preis numeric(12,2),
  /*
   * Der Kunde sieht nur den Paketpreis. Das ist kein Verstecken aus
   * Verlegenheit: bei 20 Modulklemmen zu 3,10 € diskutiert man über
   * Kleinteile statt über die Anlage.
   */
  einzelpreise_verstecken boolean not null default false,
  created_at timestamptz not null default now()
);

create index on vorgang_gruppe (vorgang_id, dokument_id, sort);

comment on table vorgang_gruppe is
  'Positionsgruppe im Angebot. Trägt wahlweise einen Paketpreis, der die '
  'Summe der enthaltenen Positionen überschreibt.';

-- -------------------------------------------------------- POSITIONEN
alter table vorgang_position
  add column if not exists gruppe_id uuid references vorgang_gruppe(id) on delete set null,
  /*
   * Optionale Positionen zählen nicht in die Summe. Der Kunde kreuzt
   * sie im Portal an, und dann zählen sie — vorher wäre der Preis
   * höher, als das Angebot verspricht.
   */
  add column if not exists optional boolean not null default false,
  add column if not exists rabatt_prozent numeric(5,2) not null default 0,
  /* Upgrade: entweder ein konkretes Produkt oder eine ganze Kategorie. */
  add column if not exists upgrade_article_id uuid references article(id),
  add column if not exists upgrade_kategorie text,
  add column if not exists upgrade_aufpreis numeric(12,2),
  add column if not exists upgrade_text text,
  /*
   * Was der Kunde daraus gemacht hat. 'standard' ist der Auslieferungs-
   * zustand; die anderen drei entstehen erst bei der Annahme und sind
   * der Beleg dafür, was er tatsächlich bestellt hat.
   */
  add column if not exists kunden_auswahl text not null default 'standard';

alter table vorgang_position
  drop constraint if exists vorgang_position_kunden_auswahl_check;
alter table vorgang_position
  add constraint vorgang_position_kunden_auswahl_check
  check (kunden_auswahl in ('standard', 'gewaehlt', 'abgewaehlt', 'upgraded'));

create index if not exists vorgang_position_gruppe_idx
  on vorgang_position (gruppe_id, sort);

comment on column vorgang_position.rabatt_prozent is
  'Rabatt auf diese Position. Der Gesamtrabatt am Vorgang kommt danach '
  'und rechnet auf die bereits rabattierte Summe.';

-- ----------------------------------------------------- ANGEBOTSTEXTE
alter table vorgang
  add column if not exists angebot_titel text,
  add column if not exists angebot_einleitung text,
  add column if not exists angebot_abschluss text,
  add column if not exists angebot_gueltig_bis date,
  add column if not exists ust_satz numeric(4,2) not null default 20,
  add column if not exists rabatt_prozent numeric(5,2) not null default 0,
  add column if not exists lieferung_netto numeric(12,2) not null default 0;

comment on column vorgang.ust_satz is
  'Gilt für alle Positionen und die Lieferung. 0 für Deutschland '
  '(PV-Nullsteuersatz), 20 für Österreich.';

/*
 * Spaltenrechte, nicht vergessen: 0025 hat das Tabellenrecht auf
 * vorgang entzogen. Jede neue Spalte braucht ihre eigene Erlaubnis,
 * sonst scheitert JEDE Abfrage, die sie mitliest — nicht nur die
 * Spalte, die ganze Zeile. Dieselbe Falle wie in 0009 und 0029.
 *
 * Texte und Steuersatz sind unbedenklich. Rabatt und Lieferkosten sind
 * kaufmännisch und laufen wie die übrigen Beträge über v_vorgang_wert.
 */
grant select (
  angebot_titel, angebot_einleitung, angebot_abschluss,
  angebot_gueltig_bis, ust_satz
) on vorgang to authenticated;

grant update (
  angebot_titel, angebot_einleitung, angebot_abschluss,
  angebot_gueltig_bis, ust_satz, rabatt_prozent, lieferung_netto
) on vorgang to authenticated;

create or replace view v_vorgang_wert
with (security_invoker = off) as
select v.id as vorgang_id, v.company_id,
       v.angebotswert_netto, v.auftragswert_netto,
       v.soll_stunden, v.soll_materialkosten,
       v.rabatt_prozent, v.lieferung_netto
from vorgang v
where v.company_id = public.current_company_id()
  and public.can('angebote', 'read');

grant select on v_vorgang_wert to authenticated;

comment on view v_vorgang_wert is
  'Beträge am Vorgang für Rollen mit Angebotsrecht. Security definer, '
  'weil authenticated auf den Spalten selbst kein Recht hat (0025/0028).';

-- ------------------------------------------------------------ ARTIKEL
alter table article
  add column if not exists pro_modul_menge numeric(8,3);

comment on column article.pro_modul_menge is
  'Menge je PV-Modul für den Schnellzusammenbau — vier Klemmen pro '
  'Modul stehen hier als 4. NULL heisst: zählt nicht mit der Modulzahl.';

-- ---------------------------------------------------------------- RLS
do $$
begin
  execute 'alter table vorgang_gruppe enable row level security';
  execute 'create policy vorgang_gruppe_sel on vorgang_gruppe for select to authenticated using (company_id = public.current_company_id())';
  execute 'create policy vorgang_gruppe_ins on vorgang_gruppe for insert to authenticated with check (company_id = public.current_company_id() and public.tenant_writable())';
  execute 'create policy vorgang_gruppe_upd on vorgang_gruppe for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id() and public.tenant_writable())';
  execute 'create policy vorgang_gruppe_del on vorgang_gruppe for delete to authenticated using (company_id = public.current_company_id())';
end $$;
