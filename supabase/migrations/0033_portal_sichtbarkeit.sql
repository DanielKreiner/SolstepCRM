-- =====================================================================
-- 0033 — Was der Kunde von seinem Vorgang sieht
--
-- Der Aktivitätsstrom trägt alles: interne Notizen, Gate-Wechsel,
-- Telefonvermerke, Kalkulationshinweise. Davon gehört ein Teil dem
-- Kunden und der Rest ausdrücklich nicht — „Nachbar meldet sich ständig,
-- Vorsicht" ist eine Notiz für das Team.
--
-- Deshalb ein Schalter je Eintrag, Voreinstellung AUS. Ein neuer
-- Ereignistyp ist damit zunächst unsichtbar. Das ist die richtige
-- Richtung: wer etwas freigibt, entscheidet das bewusst, und ein
-- vergessener Schalter zeigt zu wenig statt zu viel.
--
-- Dieselbe Überlegung wie bei den Spaltenrechten in 0009.
-- =====================================================================

alter table vorgang_event
  add column if not exists kunde_sichtbar boolean not null default false;

comment on column vorgang_event.kunde_sichtbar is
  'Erscheint im Kundenportal. Voreinstellung aus — interne Notizen, '
  'Gate-Wechsel und Kalkulationshinweise bleiben im Betrieb.';

-- Bestand: Phasenwechsel und Termine sind der Fortschritt, den der Kunde
-- ohnehin mitbekommt. Rechnungen und Zahlungen ebenfalls — es sind seine.
update vorgang_event
   set kunde_sichtbar = true
 where typ in ('phase_wechsel', 'termin', 'rechnung', 'zahlung')
   and kunde_sichtbar = false;

create index if not exists vorgang_event_portal_idx
  on vorgang_event (vorgang_id, kunde_sichtbar, created_at desc);

-- Dokumente ebenso: der Kunde sieht Angebot, Auftragsbestätigung und
-- seine Rechnungen, aber keine Materialbedarfsliste — dort stehen
-- Einkaufspreise.
alter table vorgang_dokument
  add column if not exists kunde_sichtbar boolean not null default false;

update vorgang_dokument
   set kunde_sichtbar = true
 where typ in ('angebot', 'ab', 'anzahlungsrechnung', 'schlussrechnung',
               'uebergabeprotokoll', 'e_befund')
   and kunde_sichtbar = false;

comment on column vorgang_dokument.kunde_sichtbar is
  'Im Kundenportal sichtbar. Die Materialbedarfsliste bleibt aus: dort '
  'stehen Einkaufspreise.';

-- Neue Spalten brauchen ein Leserecht (siehe Tabellenkommentar an vorgang).
-- vorgang_event und vorgang_dokument haben Tabellenrechte, keine
-- spaltenweisen — hier ist nichts nachzuholen. Geprüft, nicht angenommen.
