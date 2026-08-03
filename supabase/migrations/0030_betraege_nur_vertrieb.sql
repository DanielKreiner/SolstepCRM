-- =====================================================================
-- 0030 — Die Montage sah den Auftragswert
--
-- v_vorgang_wert hing an can('pipelines','read'). Genau dieses Recht
-- haben aber Monteur und Lager: sie brauchen es, um ihre Vorgänge
-- überhaupt zu sehen. Damit stand der Auftragswert im Kopf jedes
-- Vorgangs, den ein Monteur öffnet — gemessen im E2E-Test, nicht
-- vermutet.
--
-- Das Briefing (Abschnitt 6) zieht die Grenze anders: die Bauleitung
-- sieht den Auftragswert, die Montage sieht keine Beträge. Genau das
-- bildet 'angebote' ab — gf und Büro schreiben, die Bauleitung liest,
-- Montage und Lager haben nichts.
--
-- 'pipelines' war der falsche Hebel: es beantwortet „darf diese Rolle
-- Vorgänge sehen", nicht „darf sie Geld sehen".
-- =====================================================================

drop view if exists v_vorgang_wert;

create view v_vorgang_wert
with (security_invoker = off) as
select v.id as vorgang_id, v.company_id,
       v.angebotswert_netto, v.auftragswert_netto,
       v.soll_stunden, v.soll_materialkosten
from vorgang v
where v.company_id = public.current_company_id()
  and public.can('angebote', 'read');

grant select on v_vorgang_wert to authenticated;

comment on view v_vorgang_wert is
  'Beträge eines Vorgangs. security_definer, weil die Spalten für '
  'authenticated gesperrt sind — Mandantengrenze und Rollenprüfung '
  'stehen deshalb in der View selbst. Gehängt an can(angebote), nicht '
  'an can(pipelines): Monteur und Lager brauchen pipelines, um ihre '
  'Vorgänge zu sehen, und sollen trotzdem keine Beträge sehen.';
