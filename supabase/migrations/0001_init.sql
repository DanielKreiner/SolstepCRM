-- =====================================================================
-- Solstep Betrieb — 0001_init.sql
-- Postgres 15 / Supabase, Region eu-central-1
-- Alles UTC. Geld numeric(12,2). Mandantenfähig über company_id + RLS.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists citext;

-- ---------------------------------------------------------------- ENUMS
create type user_role      as enum ('gf','buero','bauleitung','monteur','lager');
create type customer_type  as enum ('lead','customer');
create type quote_status   as enum ('draft','sent','opened','accepted','lost','expired');
create type ticket_status  as enum ('offen','diagnose','termin_geplant','behoben');
create type tenant_status  as enum ('trial','active','readonly','cancelled');
create type time_kind      as enum ('work','travel','break','errand','training','leave_comp');
create type time_status    as enum ('running','booked','approved','flagged','replaced');
create type absence_kind   as enum ('vacation','sick','leave_comp','care','school','special');
create type approval       as enum ('requested','approved','rejected');
create type move_kind      as enum ('out','return','goods_in','correction');
create type invoice_kind   as enum ('deposit','partial','final');
create type invoice_status as enum ('draft','sent','partial','paid','overdue','cancelled');
create type po_status      as enum ('draft','open','confirmed','shipped','received');
create type perm_level     as enum ('none','read','write');

-- ------------------------------------------------------------ STAMMDATEN
create table company (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  uid_nr text,
  address text, zip text, city text, country text default 'AT',
  iban text, bic text,
  pdf_settings jsonb not null default '{}'::jsonb,
  accounting_settings jsonb not null default '{}'::jsonb,
  -- SaaS-Betrieb
  status tenant_status not null default 'trial',
  plan text not null default 'basis',
  seats int not null default 5,
  trial_ends_at timestamptz,
  stripe_customer_id text,
  storage_quota_mb int not null default 20000,
  feature_flags jsonb not null default '{}'::jsonb,
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

-- tenant_writable() steht weiter unten bei den HELPERS: die Funktion ruft
-- current_company_id() auf, und Postgres prüft den Rumpf schon beim Anlegen.

create table location (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  name text not null,
  address text, zip text, city text,
  holiday_region text not null default 'AT-1',
  worktime_rules jsonb not null default
    '{"rest_hours":11,"max_daily":10,"max_weekly":50,"break_after_min":360,"break_min":30}'::jsonb,
  min_staffing int not null default 4
);

create table app_user (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references company(id) on delete cascade,
  location_id uuid references location(id),
  name text not null,
  email citext not null,
  phone text,
  role user_role not null,
  weekly_hours numeric(5,2) not null default 38.5,
  employment_type text not null default 'vollzeit',
  hourly_cost numeric(8,2),
  vacation_days_year numeric(5,2) not null default 25,
  vacation_carry numeric(6,2) not null default 0,
  avatar_path text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on app_user (company_id, active);

create table role_permission (
  company_id uuid not null references company(id) on delete cascade,
  role user_role not null,
  area text not null,          -- pipelines|angebote|crm|lager|rechnungen|zeiterfassung|mitarbeiter|berichte|einstellungen
  level perm_level not null default 'none',
  primary key (company_id, role, area)
);

create table qualification (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  name text not null,
  issued_on date,
  valid_until date,
  document_path text
);
create index on qualification (company_id, valid_until);

-- ------------------------------------------------- PIPELINES (je Mandant)
-- Jeder Betrieb arbeitet anders. Phasen sind Stammdaten, kein Enum.
-- system_key bindet die Phase an die Automatik: darauf hängen Regeln, nicht am Label.
create table pipeline (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  kind text not null,                      -- vertrieb | projekte | service
  name text not null,
  sort int not null default 0,
  unique (company_id, kind)
);

create table pipeline_phase (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  pipeline_id uuid not null references pipeline(id) on delete cascade,
  key text not null,
  label text not null,
  sort int not null default 0,
  color text,
  system_key text,     -- null | won | lost | in_execution | ready_to_invoice | closed
  is_final boolean not null default false,
  unique (pipeline_id, key)
);
create index on pipeline_phase (company_id, pipeline_id, sort);

-- ---------------------------------------------------------------- CRM
create table customer (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  type customer_type not null default 'lead',
  number text,
  name text not null,
  contact_person text,
  email citext, phone text,
  address text, zip text, city text,
  lat double precision, lng double precision,
  source text,
  owner_id uuid references app_user(id),
  crm_pipeline text default 'neukunden',   -- neukunden|bestandskunden|service_vertrag
  crm_stage text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid, updated_at timestamptz not null default now()
);
create index on customer (company_id, type);
create index on customer using gin (name gin_trgm_ops);

create table contact_activity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete cascade,
  user_id uuid references app_user(id),
  kind text not null,          -- call|mail|portal|note|quote|system
  body text,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on contact_activity (customer_id, created_at desc);

create table plant (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete cascade,
  kwp numeric(8,2),
  storage_kwh numeric(8,2),
  modules text, inverter text,
  meter_point text,
  commissioned_on date
);

-- ------------------------------------------------------------- ARTIKEL
create table supplier (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  name text not null, email citext, phone text,
  customer_number text, framework_contract boolean not null default false
);

create table article (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  sku text not null,
  name text not null,
  manufacturer text, category text,
  unit text not null default 'Stk',
  stock numeric(12,3) not null default 0,
  min_stock numeric(12,3) not null default 0,
  location_code text,
  purchase_price numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  vat_rate numeric(4,2) not null default 20,
  active boolean not null default true,
  unique (company_id, sku)
);
create index on article using gin (name gin_trgm_ops);

create table article_alias (          -- Mapping Step-Planer -> Artikel
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  article_id uuid not null references article(id) on delete cascade,
  alias text not null,
  unique (company_id, alias)
);

create table article_supplier (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  article_id uuid not null references article(id) on delete cascade,
  supplier_id uuid not null references supplier(id) on delete cascade,
  price numeric(12,2) not null,
  lead_days int not null default 7,
  framework_contract boolean not null default false
);

-- ------------------------------------------------------------- ANGEBOT
create table quote (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete restrict,
  number text not null,
  status quote_status not null default 'draft',
  net_total numeric(12,2) not null default 0,
  cost_total numeric(12,2) not null default 0,
  margin_pct numeric(5,2) generated always as (
    case when net_total > 0 then round((net_total - cost_total) / net_total * 100, 2) else 0 end
  ) stored,
  valid_until date,
  planner_ref text,
  planner_payload jsonb,
  snapshot_path text,
  pdf_path text,
  share_token text unique,
  owner_id uuid references app_user(id),
  reminder_enabled boolean not null default true,
  sent_at timestamptz, opened_at timestamptz, accepted_at timestamptz,
  accepted_ip inet, accepted_name text,
  created_at timestamptz not null default now(),
  created_by uuid, updated_at timestamptz not null default now(),
  unique (company_id, number)
);
create index on quote (company_id, status, valid_until);

create table quote_item (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  quote_id uuid not null references quote(id) on delete cascade,
  pos int not null,
  article_id uuid references article(id),
  text text not null,
  qty numeric(12,3) not null default 1,
  unit text not null default 'Stk',
  purchase_price numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  vat_rate numeric(4,2) not null default 20,
  unmatched boolean not null default false      -- aus Import nicht zuordenbar
);
create index on quote_item (quote_id, pos);

create table quote_event (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  quote_id uuid not null references quote(id) on delete cascade,
  kind text not null,   -- created|sent|delivered|opened|pdf_downloaded|link_clicked|accepted|reminded|bounced
  meta_json jsonb not null default '{}'::jsonb,
  provider_event_id text,
  created_at timestamptz not null default now(),
  unique (company_id, provider_event_id)
);
create index on quote_event (quote_id, created_at);

-- ------------------------------------------------------------- AUFTRAG
create table job (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete restrict,
  quote_id uuid references quote(id),
  plant_id uuid references plant(id),
  location_id uuid references location(id),
  number text not null,
  phase_id uuid not null references pipeline_phase(id) on delete restrict,
  site_manager_id uuid references app_user(id),
  planned_hours numeric(8,2) not null default 0,
  value_net numeric(12,2) not null default 0,
  material_planned numeric(12,2) not null default 0,
  scheduled_from timestamptz, scheduled_to timestamptz,
  address text, zip text, city text, lat double precision, lng double precision,
  next_step text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid, updated_at timestamptz not null default now(),
  unique (company_id, number)
);
create index on job (company_id, phase_id);
create index on job (company_id, scheduled_from);

create table job_member (
  job_id uuid not null references job(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  company_id uuid not null references company(id) on delete cascade,
  primary key (job_id, user_id)
);

create table job_checklist_item (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  job_id uuid not null references job(id) on delete cascade,
  sort int not null default 0,
  label text not null,
  done boolean not null default false,
  done_at timestamptz, done_by uuid references app_user(id)
);

create table job_document (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  job_id uuid references job(id) on delete cascade,
  customer_id uuid references customer(id) on delete cascade,
  user_id uuid references app_user(id),
  kind text not null,   -- quote|delivery_note|photo|handover|invoice|grid|contract|payslip|certificate|other
  bucket text not null default 'documents',
  path text not null,
  filename text not null,
  size_bytes bigint,
  visible_to_customer boolean not null default false,
  signature_status text,          -- none|pending|signed
  signed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on job_document (company_id, kind);

create table job_appointment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  job_id uuid not null references job(id) on delete cascade,
  user_id uuid references app_user(id),
  starts_at timestamptz not null, ends_at timestamptz not null,
  title text,
  graph_event_id text, graph_calendar_id text,
  sync_state text not null default 'local',   -- local|synced|conflict|error
  customer_confirmed boolean not null default false
);
create index on job_appointment (company_id, starts_at);

-- ---------------------------------------------------------------- LAGER
create table stock_move (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  article_id uuid not null references article(id) on delete restrict,
  job_id uuid references job(id),
  user_id uuid references app_user(id),
  qty numeric(12,3) not null,
  kind move_kind not null,
  note text,
  client_uuid uuid unique,        -- Idempotenz für die Offline-Queue
  created_at timestamptz not null default now()
);
create index on stock_move (company_id, article_id, created_at desc);

create table stock_reservation (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  article_id uuid not null references article(id) on delete cascade,
  job_id uuid not null references job(id) on delete cascade,
  qty numeric(12,3) not null,
  released_at timestamptz
);

create table purchase_order (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  supplier_id uuid not null references supplier(id) on delete restrict,
  number text not null,
  status po_status not null default 'draft',
  due_date date,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);

create table purchase_order_item (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  purchase_order_id uuid not null references purchase_order(id) on delete cascade,
  article_id uuid not null references article(id) on delete restrict,
  qty numeric(12,3) not null,
  price numeric(12,2),
  received_qty numeric(12,3) not null default 0
);

-- --------------------------------------------------------- ZEITERFASSUNG
create table time_entry (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete restrict,
  job_id uuid references job(id),
  kind time_kind not null default 'work',
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_min int generated always as (
    case when ended_at is null then null
         else greatest(0, (extract(epoch from (ended_at - started_at)) / 60)::int) end
  ) stored,
  note text,
  status time_status not null default 'running',
  replaces_id uuid references time_entry(id),
  client_uuid uuid unique,        -- Idempotenz Offline-Queue
  client_ts timestamptz,
  flagged_reason text,
  created_at timestamptz not null default now(),
  created_by uuid, updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);
create index on time_entry (company_id, user_id, started_at desc);
create index on time_entry (job_id);
-- nur eine laufende Buchung je Person
create unique index one_running_per_user on time_entry (user_id) where status = 'running';

create table time_correction (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  time_entry_id uuid not null references time_entry(id) on delete cascade,
  user_id uuid not null references app_user(id),
  requested_change_json jsonb not null,
  reason text not null,
  status approval not null default 'requested',
  approver_id uuid references app_user(id),
  approver_comment text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table absence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  kind absence_kind not null,
  from_date date not null, to_date date not null,
  half_day boolean not null default false,
  status approval not null default 'requested',
  substitute_id uuid references app_user(id),
  note text,
  decided_at timestamptz, approver_id uuid references app_user(id),
  check (to_date >= from_date)
);
create index on absence (company_id, from_date, to_date);

create table time_account_move (   -- Zeitausgleich, Auszahlung, Übertrag, Korrektur
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  minutes int not null,
  kind text not null,             -- carry|payout|comp_time|correction
  reason text not null,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);

create table roster_publication (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  iso_week text not null,
  published_at timestamptz not null default now(),
  published_by uuid references app_user(id),
  warnings_json jsonb not null default '[]'::jsonb,
  unique (company_id, iso_week)
);

-- ------------------------------------------------------------ RECHNUNG
create table invoice (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  job_id uuid not null references job(id) on delete restrict,
  number text not null,
  kind invoice_kind not null,
  amount_net numeric(12,2) not null,
  vat_amount numeric(12,2) not null default 0,
  issued_on date not null default current_date,
  due_date date not null,
  paid_at timestamptz, paid_amount numeric(12,2) not null default 0,
  status invoice_status not null default 'draft',
  dunning_level int not null default 0,
  last_dunned_at timestamptz,
  pdf_path text,
  cancels_id uuid references invoice(id),
  created_at timestamptz not null default now(),
  unique (company_id, number)
);
create index on invoice (company_id, status, due_date);

-- -------------------------------------------------------------- SERVICE
create table service_ticket (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete cascade,
  job_id uuid references job(id),
  plant_id uuid references plant(id),
  number text not null,
  source text not null default 'portal',   -- portal|phone|mail
  category text not null,                  -- stoerung|frage|beschwerde|rechnung
  severity int not null default 2,
  status ticket_status not null default 'offen',
  assignee_id uuid references app_user(id),
  body text not null,
  response text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);

-- ------------------------------------------------------------- MAIL
-- Kein externer Versanddienst. Jeder Mandant hängt sein eigenes Postfach ein:
--   provider 'microsoft' -> Microsoft Graph (M365; Basic Auth für IMAP/SMTP ist dort tot)
--   provider 'imap'      -> klassisches IMAP/SMTP (A1, World4You, Easyname, Hosteurope, ...)
-- secret_enc ist AES-256-GCM, Schlüssel aus MAIL_CRED_KEY, niemals im Klartext in der DB.
create table mail_account (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  user_id uuid references app_user(id) on delete set null,   -- null = Firmenpostfach
  provider text not null check (provider in ('microsoft','imap')),
  address citext not null,
  display_name text,
  is_default boolean not null default false,
  -- IMAP/SMTP
  imap_host text, imap_port int default 993, imap_secure boolean default true,
  smtp_host text, smtp_port int default 587, smtp_secure boolean default false,
  username text,
  sent_folder text default 'Sent',
  uid_validity bigint, last_uid bigint,
  -- Microsoft Graph
  ms_tenant_id text, ms_user_id text, delta_token text, subscription_id text,
  subscription_expires_at timestamptz,
  -- Zugangsdaten (Passwort oder Refresh-Token), verschlüsselt
  secret_enc bytea,
  secret_updated_at timestamptz,
  status text not null default 'unverified',   -- unverified|ok|auth_error|error
  last_sync_at timestamptz, last_error text,
  created_at timestamptz not null default now(),
  unique (company_id, address)
);
-- Zugangsdaten nie an den Client: Spalte wird über eine View ausgeblendet
revoke all on mail_account from authenticated, anon;
create view v_mail_account as
  select id, company_id, user_id, provider, address, display_name, is_default,
         imap_host, smtp_host, username, status, last_sync_at, last_error, ms_user_id
  from mail_account;

create table mail_message (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  mail_account_id uuid not null references mail_account(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  message_id text,
  in_reply_to text,
  references_ids text[],
  thread_key text,
  from_addr citext, to_addrs text[], cc_addrs text[],
  subject text,
  body_text text,
  body_path text,              -- HTML-Teil im Storage
  raw_path text,               -- .eml im Storage
  has_attachments boolean not null default false,
  sent_at timestamptz, received_at timestamptz,
  -- Zuordnung
  customer_id uuid references customer(id) on delete set null,
  job_id uuid references job(id) on delete set null,
  quote_id uuid references quote(id) on delete set null,
  ticket_id uuid references service_ticket(id) on delete set null,
  assigned_by text,            -- token|reply_to|address|manual
  created_at timestamptz not null default now(),
  unique (company_id, mail_account_id, message_id)
);
create index on mail_message (company_id, thread_key);
create index on mail_message (customer_id, received_at desc);

create table mail_attachment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  mail_message_id uuid not null references mail_message(id) on delete cascade,
  filename text not null, mime text, size_bytes bigint, path text not null
);

create table mail_outbox (      -- Versandwarteschlange, überlebt Fehlversuche
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  mail_account_id uuid not null references mail_account(id) on delete cascade,
  to_addrs text[] not null, cc_addrs text[],
  subject text not null, body_html text not null, body_text text,
  attachments jsonb not null default '[]'::jsonb,   -- [{bucket,path,filename}]
  quote_id uuid references quote(id), job_id uuid references job(id),
  invoice_id uuid references invoice(id),
  track_token text,
  status text not null default 'queued',   -- queued|sending|sent|failed
  attempts int not null default 0, last_error text,
  send_after timestamptz not null default now(),
  sent_at timestamptz, message_id text,
  created_at timestamptz not null default now()
);
create index on mail_outbox (status, send_after);

-- -------------------------------------------------- PORTAL / CHAT / MISC
create table portal_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete cascade,
  token_hash text not null unique,
  pin_hash text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table chat_channel (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  name text not null,
  job_id uuid references job(id) on delete cascade,
  kind text not null default 'team'
);

create table chat_message (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  channel_id uuid not null references chat_channel(id) on delete cascade,
  user_id uuid references app_user(id),
  system_kind text,
  body text not null,
  created_at timestamptz not null default now()
);
create index on chat_message (channel_id, created_at desc);

create table applicant (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  position text not null,
  name text not null,
  email citext, phone text,
  stage text not null default 'neu',   -- neu|sichtung|telefonat|gespraech|probearbeit|zusage|abgelehnt
  rating int,
  next_appointment timestamptz,
  cv_path text,
  created_at timestamptz not null default now()
);

create table notification (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  user_id uuid references app_user(id) on delete cascade,
  kind text not null,
  title text not null, body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table support_session (       -- Zugriff des Betreibers auf einen Mandanten
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  operator_email citext not null,
  reason text not null,
  granted_by uuid references app_user(id),   -- Freigabe durch den Mandanten
  mode text not null default 'read',         -- read | write
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);

create table usage_snapshot (        -- Grundlage der Abrechnung
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references company(id) on delete cascade,
  period date not null,
  active_users int not null,
  jobs_created int not null default 0,
  mails_sent int not null default 0,
  storage_mb int not null default 0,
  unique (company_id, period)
);

create table job_run (               -- Idempotenz für Cron
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  run_key text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (kind, run_key)
);

create table audit_log (
  id bigserial primary key,
  company_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb, new_data jsonb,
  actor uuid,
  created_at timestamptz not null default now()
);
create index on audit_log (company_id, table_name, record_id, created_at desc);

create table doc_counter (
  company_id uuid not null references company(id) on delete cascade,
  kind text not null,               -- quote|job|invoice|ticket|purchase_order
  year int not null,
  value int not null default 0,
  primary key (company_id, kind, year)
);

-- ================================================================ HELPERS

create or replace function public.current_company_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'company_id','')::uuid
$$;

create or replace function public.current_role_name() returns user_role
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'role','')::user_role
$$;

-- Schreibsperre bei Zahlungsverzug / Kündigung, in allen Policies geprüft
create or replace function public.tenant_writable() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from company c
                 where c.id = public.current_company_id()
                   and c.status in ('trial','active'))
$$;

create or replace function public.can(p_area text, p_level perm_level) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from role_permission rp
    where rp.company_id = public.current_company_id()
      and rp.role = public.current_role_name()
      and rp.area = p_area
      and (rp.level = 'write' or rp.level = p_level)
  )
$$;

create or replace function public.next_number(p_company uuid, p_kind text, p_year int default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_year int := coalesce(p_year, extract(year from (now() at time zone 'Europe/Vienna'))::int);
        v_val int;
        v_prefix text := case p_kind
          when 'quote' then 'AN' when 'job' then 'A' when 'invoice' then 'RE'
          when 'ticket' then 'S' when 'purchase_order' then 'B' else 'X' end;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || p_kind || v_year, 0));
  insert into doc_counter(company_id, kind, year, value) values (p_company, p_kind, v_year, 1)
    on conflict (company_id, kind, year) do update set value = doc_counter.value + 1
    returning value into v_val;
  return format('%s-%s-%s', v_prefix, v_year, lpad(v_val::text, 4, '0'));
end $$;

-- Audit-Trigger (append-only)
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(company_id, table_name, record_id, action, old_data, new_data, actor)
  values (
    coalesce(new.company_id, old.company_id),
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end $$;

do $$ declare t text;
begin
  foreach t in array array['time_entry','stock_move','invoice','quote','absence','article',
                           'time_account_move','job']
  loop
    execute format(
      'create trigger %I_audit after insert or update or delete on %I
         for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- Bestandsfortschreibung
create or replace function public.apply_stock_move() returns trigger
language plpgsql as $$
begin
  update article set stock = stock + case
    when new.kind = 'out' then -abs(new.qty)
    when new.kind in ('return','goods_in') then abs(new.qty)
    else new.qty end
  where id = new.article_id;
  return new;
end $$;
create trigger stock_move_apply after insert on stock_move
  for each row execute function public.apply_stock_move();

-- updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
do $$ declare t text;
begin
  foreach t in array array['customer','quote','job','time_entry']
  loop
    execute format('create trigger %I_touch before update on %I
      for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ==================================================================== RLS

do $$
declare t record;
begin
  for t in
    select distinct c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id'
                       and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table %I enable row level security', t.tbl);
    execute format(
      'create policy %I on %I for select to authenticated using (company_id = public.current_company_id())',
      t.tbl || '_sel', t.tbl);
    execute format(
      'create policy %I on %I for insert to authenticated with check (company_id = public.current_company_id() and public.tenant_writable())',
      t.tbl || '_ins', t.tbl);
    execute format(
      'create policy %I on %I for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id() and public.tenant_writable())',
      t.tbl || '_upd', t.tbl);
    execute format(
      'create policy %I on %I for delete to authenticated using (company_id = public.current_company_id())',
      t.tbl || '_del', t.tbl);
  end loop;
end $$;

-- company selbst
alter table company enable row level security;
create policy company_select on company for select to authenticated
  using (id = public.current_company_id());

-- audit_log: nur lesen, niemals ändern
alter table audit_log enable row level security;
create policy audit_select on audit_log for select to authenticated
  using (company_id = public.current_company_id() and public.can('einstellungen','read'));
revoke insert, update, delete on audit_log from authenticated, anon;

-- Verschärfungen: Monteur sieht nur eigene Zeit- und Personaldaten
create policy time_entry_own on time_entry for select to authenticated
  using (company_id = public.current_company_id()
         and (user_id = auth.uid() or public.can('zeiterfassung','read')));
drop policy time_entry_sel on time_entry;

create policy absence_own on absence for select to authenticated
  using (company_id = public.current_company_id()
         and (user_id = auth.uid() or public.can('mitarbeiter','read')));
drop policy absence_sel on absence;

create policy invoice_perm on invoice for select to authenticated
  using (company_id = public.current_company_id() and public.can('rechnungen','read'));
drop policy invoice_sel on invoice;

-- Betreiber-Tabellen: ausschließlich Service-Role
revoke all on portal_access from authenticated, anon;
revoke all on job_run from authenticated, anon;
revoke all on usage_snapshot from authenticated, anon;
revoke insert, update, delete on support_session from authenticated, anon;
-- Der Mandant darf sehen, wer wann auf seine Daten zugegriffen hat:
create policy support_session_read on support_session for select to authenticated
  using (company_id = public.current_company_id());

-- ============================================== DEFAULT-PIPELINES JE MANDANT

create or replace function public.seed_pipelines(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into pipeline(company_id, kind, name, sort) values (p_company,'vertrieb','Vertrieb',1)
    returning id into v_id;
  insert into pipeline_phase(company_id,pipeline_id,key,label,sort,system_key,is_final) values
    (p_company,v_id,'neu','Lead neu',1,null,false),
    (p_company,v_id,'qualifiziert','Qualifiziert',2,null,false),
    (p_company,v_id,'gesendet','Angebot gesendet',3,null,false),
    (p_company,v_id,'angenommen','Angenommen',4,'won',true),
    (p_company,v_id,'verloren','Verloren',5,'lost',true);

  insert into pipeline(company_id, kind, name, sort) values (p_company,'projekte','Projekte',2)
    returning id into v_id;
  insert into pipeline_phase(company_id,pipeline_id,key,label,sort,system_key,is_final) values
    (p_company,v_id,'beauftragt','Beauftragt',1,null,false),
    (p_company,v_id,'material','Material bestellt',2,null,false),
    (p_company,v_id,'terminiert','Terminiert',3,null,false),
    (p_company,v_id,'montage','In Montage',4,'in_execution',false),
    (p_company,v_id,'netzanmeldung','Netzanmeldung',5,null,false),
    (p_company,v_id,'abgenommen','Abgenommen',6,'ready_to_invoice',false),
    (p_company,v_id,'fakturiert','Fakturiert',7,'closed',true);

  insert into pipeline(company_id, kind, name, sort) values (p_company,'service','Service',3)
    returning id into v_id;
  insert into pipeline_phase(company_id,pipeline_id,key,label,sort,system_key,is_final) values
    (p_company,v_id,'offen','Meldung offen',1,null,false),
    (p_company,v_id,'diagnose','Diagnose',2,null,false),
    (p_company,v_id,'termin','Termin geplant',3,null,false),
    (p_company,v_id,'behoben','Behoben',4,'closed',true);
end $$;

-- ================================================================ VIEWS

create or replace view v_job_kpi as
select j.id as job_id, j.company_id,
       coalesce(sum(te.duration_min) filter (where te.kind in ('work','travel'))/60.0, 0) as hours_actual,
       j.planned_hours,
       coalesce((select sum(sm.qty * a.purchase_price)
                 from stock_move sm join article a on a.id = sm.article_id
                 where sm.job_id = j.id and sm.kind = 'out'), 0) as material_actual,
       j.material_planned,
       j.value_net
from job j
left join time_entry te on te.job_id = j.id and te.status in ('booked','approved')
group by j.id;

create or replace view v_time_balance as
select u.id as user_id, u.company_id,
       coalesce(sum(te.duration_min) filter (where te.kind in ('work','travel','training')), 0) as actual_min,
       coalesce((select sum(m.minutes) from time_account_move m where m.user_id = u.id), 0) as adjust_min
from app_user u
left join time_entry te on te.user_id = u.id and te.status in ('booked','approved')
group by u.id;

create or replace view v_stock_alert as
select a.*, a.stock - coalesce((select sum(r.qty) from stock_reservation r
                                where r.article_id = a.id and r.released_at is null),0) as available
from article a
where a.active and a.stock <= a.min_stock;

create or replace view search_index as
  select company_id, 'job'::text as kind, id, number || ' ' || coalesce(city,'') as label from job
  union all select company_id, 'customer', id, name from customer
  union all select company_id, 'article', id, sku || ' ' || name from article
  union all select company_id, 'quote', id, number from quote;

-- ============================================================== STORAGE

insert into storage.buckets (id, name, public) values
  ('documents','documents',false),
  ('job-photos','job-photos',false),
  ('quote-pdf','quote-pdf',false),
  ('invoice-pdf','invoice-pdf',false),
  ('avatars','avatars',true)
on conflict (id) do nothing;

-- Pfadschema {company_id}/{entity}/{entity_id}/{uuid}-{filename}
create policy "read own company files" on storage.objects for select to authenticated
  using (bucket_id in ('documents','job-photos','quote-pdf','invoice-pdf')
         and (storage.foldername(name))[1] = public.current_company_id()::text);

create policy "write own company files" on storage.objects for insert to authenticated
  with check (bucket_id in ('documents','job-photos','quote-pdf')
              and (storage.foldername(name))[1] = public.current_company_id()::text);

-- invoice-pdf ist unveränderlich: kein insert/update für authenticated,
-- Erzeugung ausschließlich über den Service-Role-Client.
