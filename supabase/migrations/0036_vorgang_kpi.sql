-- =====================================================================
-- 0036 — Nachkalkulation am Vorgang
--
-- v_job_kpi verglich Plan und Ist je Auftrag und verschwindet mit job.
-- Dieselbe Rechnung, dieselbe Lehre aus 0004: Rückgaben zählen gegen,
-- sonst bleibt Material, das der Monteur ungebraucht ins Lager
-- zurückbucht, dem Vorgang als Kosten hängen.
--
-- Die Soll-Werte kommen aus dem angenommenen Angebot (0025) und nicht
-- mehr aus zwei Feldern am Auftrag, die niemand gepflegt hat.
--
-- Security definer und nicht invoker: die View liest auftragswert_netto,
-- soll_stunden und soll_materialkosten, und auf diesen Spalten hat
-- authenticated kein Recht (0025). Eine Invoker-View käme dort nicht
-- heran — dieselbe Falle wie bei v_vorgang_wert in 0028. Das Recht
-- prüft sie deshalb selbst.
-- =====================================================================

create or replace view v_vorgang_kpi
with (security_invoker = off) as
select
  v.id as vorgang_id,
  v.company_id,
  v.auftragswert_netto,
  v.soll_stunden,
  v.soll_materialkosten,
  coalesce((
    select sum(te.duration_min) / 60.0
    from time_entry te
    where te.vorgang_id = v.id
      and te.kind in ('work', 'travel')
      and te.status in ('booked', 'approved')
  ), 0) as ist_stunden,
  coalesce((
    select sum(
      case sm.kind
        when 'out'    then  sm.qty * a.purchase_price
        when 'return' then -sm.qty * a.purchase_price
        else 0
      end)
    from stock_move sm
    join article a on a.id = sm.article_id
    where sm.vorgang_id = v.id
      and sm.kind in ('out', 'return')
  ), 0) as ist_materialkosten
from vorgang v
where v.company_id = public.current_company_id()
  and public.can('angebote', 'read');

comment on view v_vorgang_kpi is
  'Plan gegen Ist je Vorgang. Beträge nur für Rollen mit Angebotsrecht — '
  'dieselbe Grenze wie v_vorgang_wert, damit die Montage die '
  'Nachkalkulation nicht über den Umweg eines Berichts sieht.';

grant select on v_vorgang_kpi to authenticated;
