-- =====================================================================
-- 0039 — Der Altbestand fällt
--
-- Zweiter Teil des zweistufigen Umbaus (CLAUDE.md 12.a). 0035 hat
-- vorgang_id angelegt und befüllt, der Code liest seither ausschliesslich
-- darüber. Erst jetzt verschwinden quote, job und invoice.
--
-- REIHENFOLGE: diese Migration darf erst laufen, WENN der Code ohne
-- Bezug auf diese Tabellen deployt ist. Umgekehrt nimmt sie einem
-- laufenden Betrieb mitten am Vormittag die Zeiterfassung weg.
--
-- Was NICHT fällt:
--   customer, article, plant, contact_activity — sie gehören nicht zum
--   alten Modell, sondern tragen es nur.
--   pipeline und pipeline_phase — Service-Tickets haben weiterhin
--   Phasen, die der Mandant selbst pflegt.
--   job_document und job_run — der Name täuscht: das eine sind
--   Dokumente am Vorgang und Personalakten, das andere die
--   Cron-Idempotenz.
--
-- Was verloren geht, bewusst:
--   Der Mahnlauf. Das Briefing schliesst Mahnwesen aus (Abschnitt 8);
--   überfällige Rechnungen stehen in der Offene-Posten-Liste. Wer ihn
--   zurück will, braucht eine Mahnstufe an vorgang_dokument.
--   Die Dienstplanveröffentlichung. Die Arbeitszeitprüfung ist an die
--   Terminierung gewandert und meldet dort, statt zu blockieren.
-- =====================================================================

-- -------------------------------------------------- 1. LETZTE PRÜFUNG
-- Nach 0035 darf nichts mehr offen sein. Lieber hier abbrechen als
-- stillschweigend eine Zeitbuchung ohne Bezug hinterlassen.
do $$
declare offen int;
begin
  select count(*) into offen from time_entry
   where job_id is not null and vorgang_id is null;
  if offen > 0 then
    raise exception 'Abbruch: % Zeitbuchungen hängen noch am Auftrag. Erst 0035 laufen lassen.', offen;
  end if;

  select count(*) into offen from stock_move
   where job_id is not null and vorgang_id is null;
  if offen > 0 then
    raise exception 'Abbruch: % Materialbewegungen hängen noch am Auftrag.', offen;
  end if;

  select count(*) into offen from job_document
   where job_id is not null and vorgang_id is null;
  if offen > 0 then
    raise exception 'Abbruch: % Dokumente hängen noch am Auftrag.', offen;
  end if;
end $$;

-- ------------------------------------------------------- 2. TRIGGER
-- Erst die Automatik, sonst feuert sie beim Aufräumen.
drop trigger if exists quote_event_activity on quote_event;
drop trigger if exists job_phase_activity on job;
drop trigger if exists quote_phase_sync on quote;
drop trigger if exists trg_quote_position_summe on quote_item;
drop trigger if exists trg_quote_lieferung_summe on quote;

drop function if exists public.log_quote_activity();
drop function if exists public.log_job_phase_activity();

-- ---------------------------------------------------------- 3. VIEWS
drop view if exists v_job_kpi;
drop view if exists v_pipeline_card;

-- -------------------------------------------------------- 4. SPALTEN
-- Die alten Fremdschlüssel an den überlebenden Tabellen.
alter table time_entry        drop column if exists job_id;
alter table stock_move        drop column if exists job_id;
alter table job_document      drop column if exists job_id;
alter table chat_channel      drop column if exists job_id;
alter table service_ticket    drop column if exists job_id;
alter table stock_reservation drop column if exists job_id;
alter table mail_message      drop column if exists job_id,
                              drop column if exists quote_id;
alter table mail_outbox       drop column if exists job_id,
                              drop column if exists quote_id,
                              drop column if exists invoice_id;
alter table vorgang           drop column if exists alt_quote_id,
                              drop column if exists alt_job_id;

comment on column vorgang.alt_nummern is
  'Frühere Angebots- und Auftragsnummern, durch Komma getrennt. Die '
  'Tabellen dahinter gibt es nicht mehr — der Text ist alles, was von '
  'ihnen bleibt, und er hält die Suche nach AN-2026-0104 am Leben.';

-- ------------------------------------------------------- 5. TABELLEN
-- Reihenfolge von innen nach aussen; cascade nur dort, wo die
-- abhängigen Zeilen ohnehin mitfallen sollen.
drop table if exists invoice_payment;
drop table if exists invoice_item;
drop table if exists invoice;

drop table if exists job_appointment;
drop table if exists job_checklist_item;
drop table if exists job_member;

drop table if exists quote_event;
drop table if exists quote_item;

drop table if exists job;
drop table if exists quote;

-- --------------------------------------------------- 6. NUMMERNKREISE
-- Angebots-, Auftrags- und Rechnungsnummern vergibt niemand mehr; die
-- Zählerstände bleiben stehen, damit eine später wieder eingeführte
-- Reihe nicht bei 1 anfängt und alte Belege doppelt nummeriert.
comment on table doc_counter is
  'Nummernkreise je Mandant, Art und Jahr. Die Arten quote, job und '
  'invoice werden nicht mehr vergeben — ihre Stände bleiben stehen, '
  'damit nichts doppelt nummeriert wird, falls sie zurückkehren.';
