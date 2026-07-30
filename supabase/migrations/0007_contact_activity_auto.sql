-- =====================================================================
-- 0007 — Aktivitäten laufen automatisch ein
--
-- CLAUDE.md Meilenstein 9: "Aktivitäten laufen automatisch ein (Portal,
-- Mail, Angebotsstatus)".
--
-- Bewusst als Trigger und nicht im Anwendungscode. Ein Angebot wechselt
-- den Status auf drei Wegen — Backoffice, Kundenportal und Cron — und
-- eine Zuordnung einer Mail passiert im Worker. Vier Aufrufstellen, die
-- alle daran denken müssen, sind vier Gelegenheiten, es zu vergessen.
-- In der Datenbank passiert es einmal und immer.
-- =====================================================================

create or replace function public.log_quote_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kunde uuid; v_text text;
begin
  select customer_id into v_kunde from quote where id = new.quote_id;
  if v_kunde is null then return new; end if;

  v_text := case new.kind
    when 'sent'            then 'Angebot versendet'
    when 'opened'          then 'Angebot geöffnet'
    when 'accepted'        then 'Angebot angenommen'
    when 'reminded'        then 'Erinnerung versendet'
    when 'link_clicked'    then 'Link im Angebot geklickt'
    when 'pdf_downloaded'  then 'Angebots-PDF geöffnet'
    else 'Angebot: ' || new.kind
  end;

  insert into contact_activity (company_id, customer_id, kind, body, meta_json)
  values (new.company_id, v_kunde, 'quote', v_text,
          jsonb_build_object('quote_id', new.quote_id, 'event', new.kind)
          || coalesce(new.meta_json, '{}'::jsonb));

  return new;
end $$;

create trigger quote_event_activity after insert on quote_event
  for each row execute function public.log_quote_activity();

-- ------------------------------------------------------------- TICKETS
create or replace function public.log_ticket_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into contact_activity (company_id, customer_id, kind, body, meta_json)
  values (new.company_id, new.customer_id,
          case when new.source = 'portal' then 'portal' else 'system' end,
          'Anliegen ' || new.number || ' gemeldet: ' || left(new.body, 160),
          jsonb_build_object('ticket_id', new.id, 'category', new.category,
                             'source', new.source));
  return new;
end $$;

create trigger service_ticket_activity after insert on service_ticket
  for each row execute function public.log_ticket_activity();

-- ---------------------------------------------------------------- MAIL
-- Jede zugeordnete Mail erscheint beim Kunden (CLAUDE.md 6.1).
create or replace function public.log_mail_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then return new; end if;
  -- Nur beim Zuordnen protokollieren, nicht bei jedem Feld-Update.
  if tg_op = 'UPDATE' and old.customer_id is not distinct from new.customer_id then
    return new;
  end if;

  insert into contact_activity (company_id, customer_id, kind, body, meta_json)
  values (new.company_id, new.customer_id, 'mail',
          case new.direction when 'in' then 'Mail erhalten: ' else 'Mail gesendet: ' end
            || coalesce(new.subject, '(ohne Betreff)'),
          jsonb_build_object('mail_message_id', new.id,
                             'direction', new.direction,
                             'assigned_by', new.assigned_by));
  return new;
end $$;

create trigger mail_message_activity after insert or update of customer_id
  on mail_message
  for each row execute function public.log_mail_activity();

-- ------------------------------------------------------------ AUFTRÄGE
-- Ein Phasenwechsel ist für den Kunden die sichtbarste Veränderung.
create or replace function public.log_job_phase_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  if tg_op = 'UPDATE' and old.phase_id is not distinct from new.phase_id then
    return new;
  end if;

  select label into v_label from pipeline_phase where id = new.phase_id;

  insert into contact_activity (company_id, customer_id, kind, body, meta_json)
  values (new.company_id, new.customer_id, 'system',
          'Auftrag ' || new.number || ': ' || coalesce(v_label, 'Phase geändert'),
          jsonb_build_object('job_id', new.id, 'phase_id', new.phase_id));
  return new;
end $$;

create trigger job_phase_activity after insert or update of phase_id on job
  for each row execute function public.log_job_phase_activity();

comment on table contact_activity is
  'Kundenzeitstrahl. Wird von Triggern gefüllt, nicht vom Anwendungscode — '
  'ein Angebot wechselt den Status auf drei Wegen, eine Mail wird im Worker '
  'zugeordnet. Manuelle Einträge (kind = note, call) kommen zusätzlich.';
