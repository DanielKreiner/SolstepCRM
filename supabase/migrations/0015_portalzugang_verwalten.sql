-- =====================================================================
-- 0015 — Portalzugänge aus dem Backoffice verwalten
--
-- portal_access war für `authenticated` vollständig gesperrt (0001, Zeile
-- 865). Das war richtig, solange niemand in der Anwendung Zugänge anlegte:
-- die Tabelle trägt den Hash des Zugangstokens, und der Portalpfad liest
-- sie ausschließlich mit dem Service-Role-Client.
--
-- Damit gab es aber auch keinen Weg, einen Kundenzugang zu erzeugen. Das
-- Kundenportal war gebaut und unerreichbar — der einzige existierende Token
-- stammte aus dem Seed. Beim Versuch, einen anzulegen:
--
--   permission denied for table portal_access
--
-- Jetzt: Rechte je Spalte, nicht auf der Tabelle.
--
--   lesen      alles AUSSER token_hash und pin_hash. Das Backoffice muss
--              wissen, ob ein Zugang existiert, bis wann er gilt und wann
--              er zuletzt benutzt wurde — den Hash braucht es nie.
--   anlegen    die Felder, die ein neuer Zugang setzt
--   ändern     nur revoked_at. Ein bestehender Zugang wird widerrufen,
--              nicht umgeschrieben — sonst liesse sich die Gültigkeit
--              eines fremden Tokens still verlängern.
--
-- Die Lehre aus Migration 0009 gilt weiter: ein Recht auf der TABELLE
-- deckt alle Spalten ab, auch später hinzugefügte. Deshalb steht hier
-- ausschliesslich spaltenweise GRANT.
-- =====================================================================

alter table portal_access enable row level security;

drop policy if exists portal_access_read on portal_access;
drop policy if exists portal_access_insert on portal_access;
drop policy if exists portal_access_revoke on portal_access;

create policy portal_access_read on portal_access for select to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('crm', 'read')
  );

create policy portal_access_insert on portal_access for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.can('crm', 'write')
    and public.tenant_writable()
  );

create policy portal_access_revoke on portal_access for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('crm', 'write')
    and public.tenant_writable()
  )
  with check (company_id = public.current_company_id());

grant select (
  id, company_id, customer_id, expires_at, revoked_at, last_seen_at, created_at
) on portal_access to authenticated;

grant insert (
  company_id, customer_id, token_hash, pin_hash, expires_at
) on portal_access to authenticated;

grant update (revoked_at) on portal_access to authenticated;

comment on table portal_access is
  'Zugangstoken des Kundenportals, gespeichert als Hash. Das Backoffice darf '
  'Zugänge anlegen und widerrufen, aber token_hash und pin_hash nie lesen.';
