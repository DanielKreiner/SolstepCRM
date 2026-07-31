-- =====================================================================
-- 0012 — Deckungsbeitrag-Ampel war auf jedem frischen Auftrag grün
--
-- 0011 rechnete den Deckungsbeitrag gegen das TATSÄCHLICH entnommene
-- Material. Auf einem Auftrag, auf den noch nichts gebucht ist, ergibt
-- das rechnerisch 100 % — und die Ampel steht auf grün, bevor irgendjemand
-- etwas über die Wirtschaftlichkeit weiß.
--
-- Beobachtet auf A-2026-0042 (Tischlerei Aigner, 74.900,00 EUR): "DB 100 %",
-- weil noch keine einzige Entnahme gebucht war. Genau die Aufträge, die
-- niemand geprüft hat, sahen damit am besten aus.
--
-- Neu: solange nichts entnommen wurde, rechnet die Ampel gegen das
-- KALKULIERTE Material. Das ist die beste verfügbare Schätzung und sie
-- steht schon in der Kalkulation. Sobald die erste Entnahme gebucht ist,
-- zählt der Istwert.
--
-- Bewusst nicht gelöst: ein Auftrag ohne kalkuliertes Material zeigt
-- weiterhin 100 %. Dort ist die Kalkulation leer — das ist ein Datenmangel,
-- den die Ampel nicht verstecken soll, sondern der im Auftrag auffallen muss.
-- =====================================================================

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
      when j.value_net > 0 then round(
        (j.value_net
         - coalesce(nullif(k.material_actual, 0), j.material_planned, 0)
        ) / j.value_net * 100, 2)
    end              as margin_pct,
    p.kwp            as kwp
  from job j
  join customer c on c.id = j.customer_id
  left join v_job_kpi k on k.job_id = j.id
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
