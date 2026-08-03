-- =====================================================================
-- 0037 — Der Kunde bestätigt seinen Termin
--
-- job_appointment trug customer_confirmed, und das Kundenportal fragte
-- danach. Mit dem Auftrag verschwindet die Spalte; die Funktion soll
-- bleiben, denn sie ist der einzige Rückkanal vor dem Montagetag.
--
-- Kein Boolean, sondern ein Zeitstempel: "hat bestätigt" ohne "wann"
-- hilft nicht, wenn der Kunde am Vorabend anruft und behauptet, er habe
-- nie zugesagt.
-- =====================================================================

alter table vorgang_termin
  add column if not exists kunde_bestaetigt_am timestamptz;

comment on column vorgang_termin.kunde_bestaetigt_am is
  'Zeitpunkt der Bestätigung durch den Kunden im Portal. NULL = noch '
  'nicht bestätigt. Wird nur gesetzt, nie zurückgenommen — eine '
  'Absage ist ein neuer Termin, keine gelöschte Zusage.';
