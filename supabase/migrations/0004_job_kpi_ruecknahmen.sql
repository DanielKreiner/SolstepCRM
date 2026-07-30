-- =====================================================================
-- 0004 — v_job_kpi rechnete Rückgaben nicht gegen
--
-- material_actual summierte ausschließlich kind = 'out'. Material, das der
-- Monteur ungebraucht ins Lager zurückbucht, blieb dem Auftrag als Kosten
-- hängen: der Bestand stieg, die Auftragskosten sanken nicht.
--
-- Beispiel aus dem Seed, Auftrag A-2026-0041:
--   36 Schienen entnommen, 4 zurückgegeben
--   vorher 4707,60 EUR   nachher 4632,00 EUR   Differenz 75,60 EUR
--
-- Bei einem Betrieb mit 200 Aufträgen im Jahr verschiebt das die
-- Nachkalkulation systematisch ins Positive — und zwar genau dort, wo
-- sauber zurückgebucht wird.
-- =====================================================================

create or replace view v_job_kpi as
select j.id as job_id, j.company_id,
       coalesce(sum(te.duration_min) filter (where te.kind in ('work','travel'))/60.0, 0) as hours_actual,
       j.planned_hours,
       coalesce((select sum(
                   case sm.kind
                     when 'out'    then  sm.qty * a.purchase_price
                     when 'return' then -sm.qty * a.purchase_price
                     else 0
                   end)
                 from stock_move sm join article a on a.id = sm.article_id
                 where sm.job_id = j.id
                   and sm.kind in ('out','return')), 0) as material_actual,
       j.material_planned,
       j.value_net
from job j
left join time_entry te on te.job_id = j.id and te.status in ('booked','approved')
group by j.id;

-- create or replace view setzt security_invoker zurück — erneut setzen,
-- sonst reißt Migration 0003 hier wieder auf.
alter view public.v_job_kpi set (security_invoker = on);
