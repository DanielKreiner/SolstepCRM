-- =====================================================================
-- 0018 — Das Angebot wird eine Seite, nicht eine Tabelle
--
-- Bisher war ein Angebot eine Liste von Zeilen mit Menge und Preis. Was
-- der Kunde im Portal sehen soll, ist etwas anderes: warum diese Anlage,
-- was steckt drin, was ist inklusive, was kann er dazubuchen.
--
-- Dafür fehlen drei Sorten Information:
--
--   1. Am ARTIKEL: Beschreibung, technische Daten, Datenblatt, Bild.
--      Das steht im Stamm und wird beim Übernehmen in die Position
--      kopiert — dieselbe Regel wie beim Preis: ein Angebot von heute
--      ändert sich nicht, weil morgen jemand die Beschreibung umschreibt.
--
--   2. Am ANGEBOT: ein Einleitungstext und die Entscheidung, ob der Kunde
--      Einzelpreise oder nur die Gesamtsumme sieht. Beides ist Sache des
--      Betriebs, nicht des Systems — mancher Elektriker zeigt gern jede
--      Position, mancher grundsätzlich nicht.
--
--   3. An der POSITION: welche Rolle sie spielt. Eine Position kann eine
--      normale Zeile sein, ein Paket, Bestandteil eines Pakets, eine
--      optionale Erweiterung zum Ankreuzen oder eine kostenlose Leistung.
--      Ohne diese Unterscheidung ist die Seite eine Preisliste.
--
-- Warum kind als text und nicht als Enum: die fünf Rollen sind die
-- heutige Sicht auf ein Angebot. Ein Enum zu erweitern heisst Migration
-- und Deployment in zwei Schritten; hier reicht ein Check, den man
-- ändern kann, ohne die Tabelle zu sperren.
-- =====================================================================

-- ---------- Artikel ----------
alter table article
  add column if not exists description text,
  add column if not exists tech_specs jsonb,
  add column if not exists datasheet_url text,
  add column if not exists image_url text;

comment on column article.tech_specs is
  'Technische Daten als Schlüssel-Wert-Paare. Wird im Angebot als Tabelle '
  'ausgeklappt.';

-- ---------- Angebot ----------
alter table quote
  add column if not exists intro_text text,
  add column if not exists price_display text not null default 'positionen',
  add column if not exists delivery_net numeric(12,2) not null default 0;

alter table quote
  drop constraint if exists quote_price_display_check;
alter table quote
  add constraint quote_price_display_check
  check (price_display in ('positionen', 'gesamt'));

comment on column quote.price_display is
  'positionen = jede Zeile mit Preis, gesamt = nur die Summe. Entscheidung '
  'des Betriebs je Angebot.';

-- ---------- Positionen ----------
alter table quote_item
  add column if not exists kind text not null default 'position',
  add column if not exists group_key text,
  add column if not exists category text,
  add column if not exists manufacturer text,
  add column if not exists description text,
  add column if not exists tech_specs jsonb,
  add column if not exists datasheet_url text,
  add column if not exists image_url text,
  add column if not exists optional_selected boolean not null default false;

alter table quote_item
  drop constraint if exists quote_item_kind_check;
alter table quote_item
  add constraint quote_item_kind_check
  check (kind in ('position', 'paket', 'paket_inhalt', 'option', 'leistung'));

comment on column quote_item.kind is
  'position = normale Zeile · paket = Komplettpaket mit Paketpreis · '
  'paket_inhalt = darin enthalten, ohne eigenen Preis · option = zum '
  'Ankreuzen durch den Kunden · leistung = inklusive, kostenlos';

comment on column quote_item.group_key is
  'Verbindet paket_inhalt und option mit ihrem paket. Frei gewählter '
  'Schlüssel, eindeutig innerhalb des Angebots.';

comment on column quote_item.optional_selected is
  'Vom Kunden im Portal angehakt. Nur für kind = option von Bedeutung; '
  'zählt dann in die Summe.';

/*
 * Der Kunde darf im Portal genau ein Feld ändern: das Häkchen an einer
 * optionalen Erweiterung. Alles andere bleibt dem Betrieb vorbehalten.
 * Die Prüfung sitzt in lib/portal — hier steht nur, was fachlich gilt.
 */
create index if not exists quote_item_gruppe_idx
  on quote_item (quote_id, kind, group_key);
