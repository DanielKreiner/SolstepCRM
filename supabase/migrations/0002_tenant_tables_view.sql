-- =====================================================================
-- 0002 — Liste aller mandantengebundenen Tabellen
--
-- Zweck: der RLS-Isolationstest soll nicht gegen eine handgepflegte Liste
-- laufen. Sonst fehlt genau die Tabelle im Test, die jemand letzte Woche
-- hinzugefügt hat — und das ist der Fall, der weh tut.
--
-- CLAUDE.md 12.a: "Neue Tabelle ohne Test = roter Build."
-- =====================================================================

create or replace view public.v_tenant_table as
select c.table_name::text as table_name
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema
 and t.table_name  = c.table_name
where c.table_schema = 'public'
  and c.column_name  = 'company_id'
  and t.table_type   = 'BASE TABLE';

comment on view public.v_tenant_table is
  'Alle Tabellen mit company_id. Quelle für tests/isolation.spec.ts.';

grant select on public.v_tenant_table to authenticated;
