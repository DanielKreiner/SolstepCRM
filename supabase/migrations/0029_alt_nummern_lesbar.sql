-- =====================================================================
-- 0029 — alt_nummern war für niemanden lesbar
--
-- 0025 hat vorgang das Tabellen-Leserecht entzogen und die unbedenklichen
-- Spalten einzeln gewährt. 0026 hat danach alt_quote_id, alt_job_id und
-- alt_nummern hinzugefügt — ohne Grant. Eine Abfrage, die alt_nummern
-- mitliest, schlägt damit vollständig fehl, und die Vorgangsseite war für
-- jede Rolle eine 404.
--
-- Das ist dieselbe Falle wie in 0009 und zuletzt auf der
-- Mitarbeiter-Detailseite: ein spaltenweiser GRANT deckt keine künftigen
-- Spalten ab. Die Voreinstellung "für niemanden lesbar" ist bei
-- Personendaten richtig — sie kostet nur jedes Mal einen Ausfall, wenn
-- man sie beim Hinzufügen einer Spalte vergisst.
--
-- Deshalb steht der Hinweis ab jetzt am Tabellenkommentar, wo ihn sieht,
-- wer die Tabelle ändert.
-- =====================================================================

grant select (alt_quote_id, alt_job_id, alt_nummern) on vorgang to authenticated;

comment on table vorgang is
  'Ein Vorgang trägt den ganzen Lebenszyklus von der Anfrage bis zur '
  'Schlussrechnung. Nummer und ID bleiben, nur die Phase wechselt. '
  'ACHTUNG: diese Tabelle hat spaltenweise SELECT-Rechte (0025). Eine '
  'neue Spalte ist zunächst für niemanden lesbar, und jede Abfrage, die '
  'sie mitliest, schlägt vollständig fehl. Neue Spalten brauchen einen '
  'eigenen GRANT — ausser sie sollen wie die Beträge gesperrt bleiben.';
