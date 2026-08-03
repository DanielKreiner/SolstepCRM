-- =====================================================================
-- 0016 — Planungsimport entfällt
--
-- Angebote entstehen jetzt von Hand im Angebotseditor: Positionen aus dem
-- Artikelstamm übernehmen oder frei eintragen, Mengen und Preise pflegen,
-- Summen und Marge rechnet das System nach.
--
-- Damit verlieren drei Spalten an quote ihren Zweck:
--
--   planner_ref      Referenz auf die Planung im Fremdsystem
--   planner_payload  das rohe Planungs-JSON
--   snapshot_path    der Canvas-Schnappschuss der Planung
--
-- Der technische Teil des Angebots-PDF las die Anlagendaten aus
-- planner_payload. Er liest sie jetzt aus `plant` — dieselben Daten, aber
-- als Stammdatum am Kunden gepflegt, im Kundenportal sichtbar und auf der
-- Pipelinekarte. Das ist die bessere Quelle: eine Anlage überlebt das
-- Angebot, das sie verkauft hat.
--
-- Abweichung von CLAUDE.md 6.3, die den Step-Planer als Integration
-- vorsah. Bewusste Produktentscheidung von Daniel.
--
-- Reihenfolge: diese Migration läuft NACH dem Deployment des Codes, der
-- die Spalten nicht mehr liest (CLAUDE.md 12.a, abwärtskompatible
-- Migrationen in zwei Schritten).
-- =====================================================================

alter table quote
  drop column if exists planner_ref,
  drop column if exists planner_payload,
  drop column if exists snapshot_path;

/*
 * quote_item.unmatched markierte Positionen, die der Import nicht
 * zuordnen konnte. Von Hand angelegte Positionen sind nie "nicht
 * zuordenbar" — eine freie Position ist eine bewusste Entscheidung, kein
 * Importfehler.
 */
alter table quote_item drop column if exists unmatched;
