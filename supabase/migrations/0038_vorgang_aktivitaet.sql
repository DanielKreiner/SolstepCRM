-- =====================================================================
-- 0038 — Der Kundenzeitstrahl folgt dem Vorgang
--
-- 0007 hängte die automatischen Aktivitäten an quote_event und an den
-- Phasenwechsel von job. Beide verschwinden. Ohne Ersatz wäre der
-- Zeitstrahl im CRM danach leer bis auf handgeschriebene Notizen — und
-- genau das war der Zustand, den Meilenstein 9 beheben sollte.
--
-- Wieder als Trigger und nicht im Anwendungscode: ein Vorgang wechselt
-- die Phase aus dem Board, aus der Detailseite, über die Annahme im
-- Portal und über die Kaskade. Vier Stellen, die daran denken müssten,
-- sind vier Gelegenheiten, es zu vergessen.
-- =====================================================================

create or replace function public.log_vorgang_phase_activity()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_text text;
begin
  if tg_op = 'UPDATE' and old.phase is not distinct from new.phase then
    return new;
  end if;

  -- Kundensprache, nicht Systemschlüssel: im Zeitstrahl steht, was der
  -- Betrieb dem Kunden am Telefon sagen würde.
  v_text := case new.phase
    when 'anfrage'    then 'Anfrage erfasst'
    when 'aufnahme'   then 'Aufnahme vor Ort'
    when 'angebot'    then 'Angebot gelegt'
    when 'beauftragt' then 'Auftrag erteilt'
    when 'montage'    then 'Montage terminiert'
    when 'abschluss'  then 'Abgeschlossen'
    when 'verloren'   then 'Nicht zustande gekommen'
    else 'Phase geändert'
  end;

  insert into contact_activity (company_id, customer_id, kind, body, meta_json)
  values (
    new.company_id, new.customer_id, 'system',
    new.number || ': ' || v_text,
    jsonb_build_object('vorgang_id', new.id, 'phase', new.phase)
  );
  return new;
end $$;

drop trigger if exists vorgang_phase_activity on vorgang;
create trigger vorgang_phase_activity
  after insert or update of phase on vorgang
  for each row execute function public.log_vorgang_phase_activity();

-- ------------------------------------------------------ ANGEBOTSSTATUS
-- Versand, Annahme und Rechnungsstellung hängen am Dokument. Der Kunde
-- soll im Zeitstrahl sehen, was er bekommen hat — nicht nur, in welcher
-- Phase sein Vorgang steht.
create or replace function public.log_vorgang_dokument_activity()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kunde uuid; v_nummer text; v_text text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  -- Ein Entwurf ist noch nichts, was den Kunden erreicht hat.
  if new.status is null or new.status = 'entwurf' then return new; end if;

  select customer_id, number into v_kunde, v_nummer
    from vorgang where id = new.vorgang_id;
  if v_kunde is null then return new; end if;

  v_text := case new.typ
    when 'angebot'             then 'Angebot'
    when 'ab'                  then 'Auftragsbestätigung'
    when 'anzahlungsrechnung'  then 'Anzahlungsrechnung'
    when 'schlussrechnung'     then 'Schlussrechnung'
    else new.typ
  end || ' ' || case new.status
    when 'versendet'  then 'versendet'
    when 'angenommen' then 'angenommen'
    when 'bezahlt'    then 'bezahlt'
    when 'storniert'  then 'storniert'
    else new.status
  end;

  insert into contact_activity (company_id, customer_id, kind, body, meta_json)
  values (
    new.company_id, v_kunde, 'quote',
    v_nummer || ': ' || v_text,
    jsonb_build_object(
      'vorgang_id', new.vorgang_id, 'dokument_id', new.id,
      'typ', new.typ, 'status', new.status
    )
  );
  return new;
end $$;

drop trigger if exists vorgang_dokument_activity on vorgang_dokument;
create trigger vorgang_dokument_activity
  after insert or update of status on vorgang_dokument
  for each row execute function public.log_vorgang_dokument_activity();

comment on table contact_activity is
  'Kundenzeitstrahl. Wird von Triggern gefüllt, nicht vom Anwendungscode — '
  'ein Vorgang wechselt die Phase auf vier Wegen, eine Mail wird im Worker '
  'zugeordnet. Manuelle Einträge (kind = note, call) kommen zusätzlich.';
