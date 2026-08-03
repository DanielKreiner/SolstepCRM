-- =====================================================================
-- 0032 — Der Altbezug blockierte das Löschen
--
-- 0026 hat vorgang.alt_job_id und alt_quote_id als Fremdschlüssel ohne
-- Löschregel angelegt. Seitdem lässt sich ein Auftrag oder Angebot nicht
-- mehr entfernen, sobald ein Vorgang darauf zeigt — und da die Übernahme
-- für JEDEN Auftrag einen Vorgang angelegt hat, gilt das für alle.
--
-- Aufgefallen ist es an einem Test, dessen Aufräumen still fehlschlug:
-- der Auftrag blieb stehen, die anschliessende Angebotsannahme sah ihn,
-- hielt das Angebot für längst angenommen und schrieb weder Name noch
-- Zeitpunkt. Ein Löschversuch, dessen Fehler niemand liest, ist genau die
-- Sorte Fehler, die man drei Wochen später sucht.
--
-- Die Regel ist set null, nicht cascade: verschwindet der alte Auftrag,
-- soll der Vorgang bleiben. Seine Herkunft steht ohnehin in alt_nummern
-- als Text — der Zeiger ist Bequemlichkeit, nicht Beleg.
-- =====================================================================

alter table vorgang drop constraint if exists vorgang_alt_job_id_fkey;
alter table vorgang drop constraint if exists vorgang_alt_quote_id_fkey;

alter table vorgang
  add constraint vorgang_alt_job_id_fkey
  foreign key (alt_job_id) references job(id) on delete set null;

alter table vorgang
  add constraint vorgang_alt_quote_id_fkey
  foreign key (alt_quote_id) references quote(id) on delete set null;
