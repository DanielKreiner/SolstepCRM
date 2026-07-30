-- =====================================================================
-- 0006 — Phasen auch für Angebote und Servicetickets
--
-- CLAUDE.md 5.1a: "Phasen sind Stammdaten je Mandant, kein Enum."
-- job.phase_id erfüllt das, quote und service_ticket nicht: dort hing die
-- Pipeline an quote_status bzw. ticket_status. Ein Betrieb, der im Vertrieb
-- eine eigene Zwischenstufe braucht ("Finanzierung geklärt"), konnte sie
-- nicht anlegen.
--
-- Aufteilung nach dem Fix:
--   phase_id  = die Pipeline-Position. Einzige Quelle für Board und Filter.
--   status    = der technische Lebenszyklus (versendet, geöffnet, storniert).
--               Bleibt erhalten, weil Mailversand und PDF daran hängen.
--
-- Ein Trigger zieht status nach, aber ausschließlich anhand von system_key —
-- niemals anhand des Labels. Ein umbenanntes "Angenommen" bricht nichts.
-- =====================================================================

alter table quote          add column phase_id uuid references pipeline_phase(id);
alter table service_ticket add column phase_id uuid references pipeline_phase(id);

create index on quote (company_id, phase_id);
create index on service_ticket (company_id, phase_id);

-- ------------------------------------------------------------ BACKFILL
update quote q set phase_id = ph.id
from pipeline p
join pipeline_phase ph on ph.pipeline_id = p.id
where p.company_id = q.company_id
  and p.kind = 'vertrieb'
  and ph.key = case q.status
        when 'accepted' then 'angenommen'
        when 'lost'     then 'verloren'
        when 'expired'  then 'verloren'
        when 'sent'     then 'gesendet'
        when 'opened'   then 'gesendet'
        else 'neu'
      end
  and q.phase_id is null;

update service_ticket t set phase_id = ph.id
from pipeline p
join pipeline_phase ph on ph.pipeline_id = p.id
where p.company_id = t.company_id
  and p.kind = 'service'
  and ph.key = case t.status
        when 'diagnose'       then 'diagnose'
        when 'termin_geplant' then 'termin'
        when 'behoben'        then 'behoben'
        else 'offen'
      end
  and t.phase_id is null;

-- ------------------------------------------------------------- TRIGGER
-- Nur die fünf Semantiken aus system_key dürfen dem Code bekannt sein.
create or replace function public.sync_quote_status() returns trigger
language plpgsql as $$
declare v_key text;
begin
  if new.phase_id is null then return new; end if;
  select system_key into v_key from pipeline_phase where id = new.phase_id;

  if v_key = 'won' then
    new.status := 'accepted';
    new.accepted_at := coalesce(new.accepted_at, now());
  elsif v_key = 'lost' then
    new.status := 'lost';
  end if;
  -- Alles andere bleibt: 'sent' und 'opened' setzt der Versand, nicht das Board.
  return new;
end $$;

create trigger quote_phase_sync before insert or update of phase_id on quote
  for each row execute function public.sync_quote_status();

create or replace function public.sync_ticket_status() returns trigger
language plpgsql as $$
declare v_key text;
begin
  if new.phase_id is null then return new; end if;
  select system_key into v_key from pipeline_phase where id = new.phase_id;

  if v_key = 'closed' then
    new.status := 'behoben';
    new.responded_at := coalesce(new.responded_at, now());
  elsif new.status = 'behoben' then
    -- Wieder aufgemacht: der Haken darf nicht stehen bleiben.
    new.status := 'offen';
  end if;
  return new;
end $$;

create trigger ticket_phase_sync before insert or update of phase_id on service_ticket
  for each row execute function public.sync_ticket_status();

-- ------------------------------------------------------- PIPELINE-KARTEN
-- Eine Liste, drei Renderer (Board, Tabelle, Timeline) — CLAUDE.md 5.1.
-- Die View vereinheitlicht nur die Anzeige; geschrieben wird immer auf der
-- jeweiligen Fachtabelle.
create or replace view v_pipeline_card as
  select
    'projekte'::text as kind,
    j.company_id,
    j.id,
    j.number,
    j.phase_id,
    c.id            as customer_id,
    c.name          as customer_name,
    j.value_net     as value_net,
    j.scheduled_from as due_at,
    j.city,
    j.next_step     as note,
    j.site_manager_id as owner_id,
    j.updated_at
  from job j
  join customer c on c.id = j.customer_id

  union all

  select
    'vertrieb', q.company_id, q.id, q.number, q.phase_id,
    c.id, c.name, q.net_total,
    q.valid_until::timestamptz, c.city, null, q.owner_id, q.updated_at
  from quote q
  join customer c on c.id = q.customer_id

  union all

  select
    'service', t.company_id, t.id, t.number, t.phase_id,
    c.id, c.name, 0::numeric(12,2),
    t.created_at, c.city, t.body, t.assignee_id, t.created_at
  from service_ticket t
  join customer c on c.id = t.customer_id;

alter view public.v_pipeline_card set (security_invoker = on);
grant select on public.v_pipeline_card to authenticated;
