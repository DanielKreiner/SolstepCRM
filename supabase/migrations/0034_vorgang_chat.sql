-- =====================================================================
-- 0034 — Chat, Bilder und Rückfragen am Vorgang
--
-- Bisher konnte der Kunde ein Anliegen melden (service_ticket) und
-- danach nachfragen. Am Vorgang selbst gab es nichts: kein Gespräch, kein
-- Foto, keine Möglichkeit für den Techniker, etwas gezielt zu erfragen.
--
-- Drei Dinge kommen dazu:
--
--   vorgang_nachricht   Ein Gespräch je Vorgang, beide Richtungen, mit
--                       Anhang. Interne Nachrichten bleiben im Betrieb.
--   vorgang_anhang      Dateien, an Nachricht oder Rückfrage hängend.
--   vorgang_anfrage     Eine Rückfrage des Betriebs an den Kunden, die
--                       der Kunde beantwortet — mit Text und optional
--                       einem Foto. „Schicken Sie ein Bild vom
--                       Zählerkasten" ist die häufigste Frage vor jeder
--                       Montage, und sie per Mail zu stellen bedeutet,
--                       die Antwort später in einem Postfach zu suchen.
--
-- Getrennt vom Aktivitätsstrom: der Strom ist die Historie und wird
-- geschrieben, nicht gelesen und beantwortet. Ein Gespräch braucht
-- Richtung, Ungelesen-Zustand und Anhänge — das in vorgang_event zu
-- pressen hiesse, beides schlechter zu machen.
-- =====================================================================

create table vorgang_nachricht (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  -- 'kunde' schreibt aus dem Portal, 'betrieb' aus dem Backoffice.
  autor text not null check (autor in ('kunde', 'betrieb')),
  autor_user_id uuid references app_user(id),
  -- Anzeigename fürs Portal: der Kunde soll einen Namen sehen, keine UUID.
  autor_name text,
  body text not null check (length(btrim(body)) > 0),
  -- Interne Nachricht — steht im Betrieb, erreicht das Portal nie.
  intern boolean not null default false,
  -- Antwort auf eine Rückfrage, falls sie dazu gehört.
  anfrage_id uuid,
  gelesen_am timestamptz,
  created_at timestamptz not null default now()
);

create index on vorgang_nachricht (vorgang_id, created_at);

create table vorgang_anfrage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  titel text not null,
  beschreibung text,
  -- Braucht die Antwort ein Bild? Beim Zählerkasten ja, bei einer
  -- Terminfrage nicht.
  foto_noetig boolean not null default false,
  status text not null default 'offen' check (status in ('offen', 'beantwortet', 'erledigt')),
  antwort_text text,
  beantwortet_am timestamptz,
  gestellt_von uuid references app_user(id),
  created_at timestamptz not null default now()
);

create index on vorgang_anfrage (vorgang_id, status);

alter table vorgang_nachricht
  add constraint vorgang_nachricht_anfrage_fk
  foreign key (anfrage_id) references vorgang_anfrage(id) on delete set null;

create table vorgang_anhang (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  vorgang_id uuid not null references vorgang(id) on delete cascade,
  nachricht_id uuid references vorgang_nachricht(id) on delete cascade,
  anfrage_id uuid references vorgang_anfrage(id) on delete cascade,
  storage_path text not null,
  dateiname text not null,
  mime text not null,
  groesse_bytes int not null,
  hochgeladen_von text not null check (hochgeladen_von in ('kunde', 'betrieb')),
  created_at timestamptz not null default now()
);

create index on vorgang_anhang (vorgang_id, created_at);

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['vorgang_nachricht', 'vorgang_anfrage', 'vorgang_anhang']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (company_id = public.current_company_id())',
      t || '_sel', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (company_id = public.current_company_id() and public.tenant_writable())',
      t || '_ins', t);
    execute format(
      'create policy %I on %I for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id() and public.tenant_writable())',
      t || '_upd', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (company_id = public.current_company_id())',
      t || '_del', t);
  end loop;
end $$;

-- Aus dem Backoffice schreibt der Betrieb, nie im Namen des Kunden.
drop policy vorgang_nachricht_ins on vorgang_nachricht;
create policy vorgang_nachricht_ins on vorgang_nachricht
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and autor = 'betrieb'
  );

-- Der Portalpfad schreibt mit dem Service-Role-Client und schränkt selbst
-- auf customer_id ein (CLAUDE.md 4.3).

comment on table vorgang_nachricht is
  'Gespräch am Vorgang. Interne Nachrichten (intern = true) erreichen das '
  'Kundenportal nie.';
