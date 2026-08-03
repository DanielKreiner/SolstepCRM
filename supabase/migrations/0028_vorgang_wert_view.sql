-- =====================================================================
-- 0028 — v_vorgang_wert lieferte niemandem etwas
--
-- 0025 hat vorgang die Spaltenrechte entzogen und die Beträge über eine
-- View freigegeben. Die View war aber security_invoker: sie liest mit den
-- Rechten des Aufrufers, und der hat auf genau diese Spalten kein
-- Leserecht. Ergebnis: leere View für alle, Board ohne Summen,
-- Vorgangskopf ohne Auftragswert.
--
-- Richtig ist security_definer — dann liest die View mit den Rechten
-- ihres Eigentümers und kommt an die Spalten heran. Der Preis: RLS auf
-- vorgang greift nicht mehr automatisch, also muss die View die
-- Mandantengrenze selbst ziehen. Beides steht deshalb ausdrücklich in
-- der WHERE-Klausel:
--
--   company_id = current_company_id()   → kein fremder Mandant
--   can('pipelines','read')             → keine Beträge für die Montage
--
-- Dieselbe Bauart wie v_mail_account in 0003, nur andersherum begründet.
-- =====================================================================

drop view if exists v_vorgang_wert;

create view v_vorgang_wert
with (security_invoker = off) as
select v.id as vorgang_id, v.company_id,
       v.angebotswert_netto, v.auftragswert_netto,
       v.soll_stunden, v.soll_materialkosten
from vorgang v
where v.company_id = public.current_company_id()
  and public.can('pipelines', 'read');

grant select on v_vorgang_wert to authenticated;

comment on view v_vorgang_wert is
  'Beträge eines Vorgangs. security_definer, weil die Spalten für '
  'authenticated gesperrt sind — Mandantengrenze und Rollenprüfung '
  'stehen deshalb in der View selbst.';
