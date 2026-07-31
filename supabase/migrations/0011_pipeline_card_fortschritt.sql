-- =====================================================================
-- 0011 — Pipelinekarte trägt Fortschritt, Deckungsbeitrag und Anlagengröße
--
-- SPEC 4.2 verlangt auf der Karte: "Nummer, Kunde, Ort + Anlagengröße,
-- Wert, nächster Schritt, Fortschritt Stunden ist/soll, Avatar-Stack,
-- Deckungsbeitrag-Ampel, Statuspill der Phase."
--
-- Bisher lieferte v_pipeline_card nur die erste Hälfte davon. Die Karte
-- konnte deshalb nicht zeigen, was sie zeigen soll — und ein Board, auf
-- dem man nicht sieht, welcher Auftrag aus dem Ruder läuft, ist eine
-- Liste mit Spalten.
--
-- Die drei neuen Werte je Zweig:
--
--   projekte  hours_actual/planned_hours aus v_job_kpi, Deckungsbeitrag
--             aus Auftragswert minus tatsächlichem Material. Das ist der
--             Deckungsbeitrag NACH Material, nicht nach Lohn — Lohnkosten
--             hängen am Stundensatz, und der ist Personendatum
--             (Migration 0009). Eine Kennzahl, die jeder Monteur auf dem
--             Board sieht, darf ihn nicht enthalten.
--
--   vertrieb  margin_pct steht bereits generiert auf quote.
--
--   service   keine der drei Größen. Ein Servicefall hat weder Auftragswert
--             noch Stundenplan; null ist hier die richtige Antwort und
--             nicht 0.
--
-- security_invoker muss erneut gesetzt werden: create or replace view
-- setzt die Option zurück, und ohne sie umgeht die View die
-- Mandantentrennung der Basistabellen (siehe Migration 0003).
-- =====================================================================

-- create or replace scheitert hier: der Zweig "service" lieferte value_net
-- bisher als numeric(12,2), und eine Ersetzung darf weder Typ noch Reihenfolge
-- bestehender Spalten ändern. Auf v_pipeline_card hängt keine weitere View,
-- das Verwerfen ist deshalb folgenlos.
drop view if exists public.v_pipeline_card;

create view v_pipeline_card as
  select
    'projekte'::text as kind,
    j.company_id,
    j.id,
    j.number,
    j.phase_id,
    c.id             as customer_id,
    c.name           as customer_name,
    j.value_net      as value_net,
    j.scheduled_from as due_at,
    j.city,
    j.next_step      as note,
    j.site_manager_id as owner_id,
    j.updated_at,
    k.hours_actual   as hours_actual,
    j.planned_hours  as planned_hours,
    case
      when j.value_net > 0
        then round((j.value_net - k.material_actual) / j.value_net * 100, 2)
    end              as margin_pct,
    p.kwp            as kwp
  from job j
  join customer c on c.id = j.customer_id
  left join v_job_kpi k on k.job_id = j.id
  -- Ein Kunde kann mehrere Anlagen haben. Für das Kartenlabel zählt die
  -- größte — sie beschreibt das Objekt, um das es geht.
  left join lateral (
    select pl.kwp from plant pl
    where pl.customer_id = c.id
    order by pl.kwp desc nulls last
    limit 1
  ) p on true

  union all

  select
    'vertrieb', q.company_id, q.id, q.number, q.phase_id,
    c.id, c.name, q.net_total,
    q.valid_until::timestamptz, c.city, null, q.owner_id, q.updated_at,
    null::numeric, null::numeric, q.margin_pct, p.kwp
  from quote q
  join customer c on c.id = q.customer_id
  left join lateral (
    select pl.kwp from plant pl
    where pl.customer_id = c.id
    order by pl.kwp desc nulls last
    limit 1
  ) p on true

  union all

  select
    'service', t.company_id, t.id, t.number, t.phase_id,
    c.id, c.name, 0::numeric,
    t.created_at, c.city, t.body, t.assignee_id, t.created_at,
    null::numeric, null::numeric, null::numeric, p.kwp
  from service_ticket t
  join customer c on c.id = t.customer_id
  left join lateral (
    select pl.kwp from plant pl
    where pl.customer_id = c.id
    order by pl.kwp desc nulls last
    limit 1
  ) p on true;

alter view public.v_pipeline_card set (security_invoker = on);
grant select on public.v_pipeline_card to authenticated;
