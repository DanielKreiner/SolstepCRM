-- Anliegen aus dem Kundenportal brauchen einen Rückkanal.
--
-- Bisher hatte service_ticket genau ein Feld `response`. Damit lässt sich
-- eine Frage einmal beantworten und danach nie wieder etwas sagen — der
-- Kunde kann nicht nachfragen, der Betrieb nicht nachschieben. In der
-- Praxis ist ein Anliegen aber ein Hin und Her über mehrere Tage.
--
-- Deshalb ein Verlauf. `response` bleibt vorerst stehen und wird beim
-- ersten Schreiben weiter mitgeführt (zweistufige Migration nach 12.a);
-- gelesen wird ab jetzt der Verlauf.

create table if not exists service_message (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  ticket_id uuid not null references service_ticket(id) on delete cascade,
  -- 'kunde' schreibt aus dem Portal, 'betrieb' aus dem Backoffice.
  author text not null check (author in ('kunde', 'betrieb')),
  -- Bei 'betrieb' der schreibende Nutzer, bei 'kunde' null.
  author_user_id uuid references app_user(id),
  -- Anzeigename für das Portal: der Kunde soll einen Namen sehen, keine UUID.
  author_name text,
  body text not null check (length(btrim(body)) > 0),
  -- Interne Notiz — steht im Backoffice, erreicht das Portal nie.
  internal boolean not null default false,
  read_by_customer_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists service_message_ticket_idx
  on service_message (ticket_id, created_at);

alter table service_message enable row level security;

grant select, insert, update, delete on service_message to authenticated;

-- Mandantentrennung wie überall: company_id gegen das JWT.
-- Rechtebereich ist 'pipelines' — Servicetickets sind die dritte Pipeline,
-- einen eigenen Bereich dafür gibt es in der Rollenmatrix bewusst nicht.
drop policy if exists service_message_select on service_message;
create policy service_message_select on service_message
  for select to authenticated
  using (company_id = public.current_company_id() and public.can('pipelines', 'read'));

drop policy if exists service_message_insert on service_message;
create policy service_message_insert on service_message
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.can('pipelines', 'write')
    and public.tenant_writable()
    -- Aus dem Backoffice schreibt der Betrieb, nie im Namen des Kunden.
    and author = 'betrieb'
  );

drop policy if exists service_message_update on service_message;
create policy service_message_update on service_message
  for update to authenticated
  using (company_id = public.current_company_id() and public.can('pipelines', 'write'))
  with check (company_id = public.current_company_id() and public.tenant_writable());

drop policy if exists service_message_delete on service_message;
create policy service_message_delete on service_message
  for delete to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('pipelines', 'write')
    and public.tenant_writable()
  );

-- Der Portalpfad liest und schreibt ausschließlich mit dem Service-Role-
-- Client und schränkt selbst auf customer_id ein (CLAUDE.md 4.3).

-- Bestehende Antworten in den Verlauf holen, damit nichts verlorengeht.
insert into service_message (company_id, ticket_id, author, author_name, body, created_at)
select t.company_id, t.id, 'betrieb', null, t.response,
       coalesce(t.responded_at, t.created_at)
  from service_ticket t
 where t.response is not null
   and length(btrim(t.response)) > 0
   and not exists (
     select 1 from service_message m
      where m.ticket_id = t.id and m.author = 'betrieb'
   );

-- Die ursprüngliche Frage des Kunden gehört ebenfalls in den Verlauf,
-- sonst beginnt jeder Thread mit der Antwort.
insert into service_message (company_id, ticket_id, author, body, created_at)
select t.company_id, t.id, 'kunde', t.body, t.created_at
  from service_ticket t
 where not exists (
   select 1 from service_message m
    where m.ticket_id = t.id and m.author = 'kunde'
 );
