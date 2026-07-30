-- =====================================================================
-- 0003 — Views durchbrachen die Mandantentrennung
--
-- Eine Postgres-View läuft standardmäßig mit den Rechten ihres Eigentümers
-- (security_invoker = off). Die Views aus 0001 gehören postgres, also wurde
-- die RLS der Basistabellen beim Lesen NICHT ausgewertet: jeder angemeldete
-- Nutzer sah darüber die Daten aller Mandanten.
--
-- Nachgewiesen vor dem Fix, angemeldet als gf@hofstaetter:
--   v_job_kpi        4 Zeilen, davon 1 fremd
--   v_time_balance   6 Zeilen, davon 1 fremd
--   search_index    14 Zeilen, davon 3 fremd
--
-- search_index ist die Quelle der Command-Palette. Ohne diesen Fix hätte
-- jeder Monteur über ⌘K die Auftragsnummern, Kundennamen und Artikel
-- sämtlicher anderer Betriebe durchsuchen können.
--
-- Der RLS-Isolationstest hat das nicht gefunden, weil v_tenant_table nur
-- BASE TABLE aufgelistet hat. Das wird hier mit repariert.
-- =====================================================================

alter view public.v_job_kpi      set (security_invoker = on);
alter view public.v_time_balance set (security_invoker = on);
alter view public.v_stock_alert  set (security_invoker = on);
alter view public.search_index   set (security_invoker = on);

-- v_mail_account ist der Sonderfall: mail_account ist für authenticated
-- komplett gesperrt, damit secret_enc niemals an den Client kann. Mit
-- security_invoker bräuchte der Aufrufer aber Leserecht auf die Tabelle.
-- Lösung: spaltengenaues SELECT-Recht auf genau die Spalten der View —
-- secret_enc bleibt gesperrt, RLS greift wieder.
grant select (
  id, company_id, user_id, provider, address, display_name, is_default,
  imap_host, smtp_host, username, status, last_sync_at, last_error, ms_user_id
) on public.mail_account to authenticated;

alter view public.v_mail_account set (security_invoker = on);

-- v_tenant_table bleibt bewusst definer-basiert: sie soll alle
-- mandantengebundenen Relationen aufzählen, auch die, auf die authenticated
-- gar kein Recht hat. Sonst prüft der Isolationstest genau die Tabellen
-- nicht, bei denen jemand später versehentlich ein Recht vergibt.
create or replace view public.v_tenant_table as
select c.table_name::text as table_name,
       t.table_type::text as table_type
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema
 and t.table_name  = c.table_name
where c.table_schema = 'public'
  and c.column_name  = 'company_id'
  and t.table_type in ('BASE TABLE', 'VIEW');

comment on view public.v_tenant_table is
  'Alle Tabellen UND Views mit company_id. Quelle für tests/isolation.spec.ts.';

grant select on public.v_tenant_table to authenticated;
