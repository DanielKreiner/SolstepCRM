-- =====================================================================
-- 0035 — Bezüge auf den Vorgang umhängen
--
-- Schritt 8 des Umbaus in zwei Teilen, wie CLAUDE.md 12.a es verlangt:
-- diese Migration ist rein additiv und läuft neben dem alten Code. Sie
-- legt vorgang_id an, füllt es und lässt job_id, quote_id und
-- invoice_id unangetastet stehen. Erst 0036 entfernt sie — nachdem der
-- Code ohne Bezug auf die alten Tabellen deployt ist.
--
-- Wer die Reihenfolge umdreht, nimmt einem laufenden Betrieb mitten am
-- Vormittag die Zeiterfassung weg.
-- =====================================================================

-- ----------------------------------------------------- 1. NACHZÜGLER
-- Zwischen 0026 und heute sind Aufträge und Angebote entstanden, die
-- keinen Vorgang haben. Ohne diesen Nachlauf verlören ihre Zeit- und
-- Materialbuchungen gleich im nächsten Schritt den Bezug. Beide Blöcke
-- sind wörtlich die aus 0026 und durch not exists geschützt.
insert into vorgang (
  company_id, customer_id, number, phase,
  kwp, speicher_kwh, adresse, plz, ort,
  angebotswert_netto, auftragswert_netto,
  soll_materialkosten,
  zustaendig_user_id, phase_seit, created_at, created_by,
  alt_job_id, alt_quote_id, alt_nummern,
  verloren_grund
)
select
  j.company_id,
  j.customer_id,
  public.next_number(j.company_id, 'vorgang'),
  public.phase_aus_altbestand(
    p.system_key, j.scheduled_from is not null, j.closed_at is not null
  ),
  pl.kwp, pl.storage_kwh,
  j.address, j.zip, j.city,
  q.net_total, j.value_net,
  j.material_planned,
  j.site_manager_id, j.created_at, j.created_at, j.created_by,
  j.id, j.quote_id,
  trim(both ', ' from concat_ws(', ', j.number, q.number)),
  case
    when public.phase_aus_altbestand(
      p.system_key, j.scheduled_from is not null, j.closed_at is not null
    ) = 'verloren' then 'sonstiges'::verloren_grund
  end
from job j
join pipeline_phase p on p.id = j.phase_id
left join quote q on q.id = j.quote_id
left join plant pl on pl.id = j.plant_id
where not exists (select 1 from vorgang v where v.alt_job_id = j.id);

insert into vorgang (
  company_id, customer_id, number, phase,
  kwp, speicher_kwh, adresse, plz, ort,
  angebotswert_netto, zustaendig_user_id,
  phase_seit, created_at, created_by,
  alt_quote_id, alt_nummern,
  verloren_grund, verloren_am
)
select
  q.company_id,
  q.customer_id,
  public.next_number(q.company_id, 'vorgang'),
  case
    when q.status = 'lost' then 'verloren'::vorgang_phase
    when q.status = 'expired' then 'verloren'::vorgang_phase
    when q.accepted_at is not null then 'beauftragt'::vorgang_phase
    when q.sent_at is not null then 'angebot'::vorgang_phase
    when c.type = 'lead' then 'anfrage'::vorgang_phase
    else 'aufnahme'::vorgang_phase
  end,
  pl.kwp, pl.storage_kwh,
  c.address, c.zip, c.city,
  q.net_total, q.owner_id,
  coalesce(q.sent_at, q.created_at), q.created_at, q.created_by,
  q.id, q.number,
  case when q.status in ('lost', 'expired') then 'sonstiges'::verloren_grund end,
  case when q.status in ('lost', 'expired') then coalesce(q.updated_at, q.created_at) end
from quote q
join customer c on c.id = q.customer_id
left join plant pl on pl.customer_id = q.customer_id
where not exists (select 1 from job j where j.quote_id = q.id)
  and not exists (select 1 from vorgang v where v.alt_quote_id = q.id);

-- Rechnungen, die seit 0026 dazugekommen sind, ebenso.
insert into vorgang_dokument (
  company_id, vorgang_id, typ, nummer, dateiname,
  betrag_netto, betrag_brutto, status, faellig_am, created_at
)
select
  i.company_id, v.id,
  case when i.kind = 'deposit' then 'anzahlungsrechnung' else 'schlussrechnung' end,
  i.number,
  concat('Rechnung ', i.number, '.pdf'),
  i.amount_net, i.amount_net + i.vat_amount,
  case
    when i.paid_at is not null then 'bezahlt'
    when i.status = 'draft' then 'entwurf'
    when i.status = 'cancelled' then 'storniert'
    else 'versendet'
  end,
  i.due_date, i.created_at
from invoice i
join vorgang v on v.alt_job_id = i.job_id
where not exists (
  select 1 from vorgang_dokument d
  where d.company_id = i.company_id and d.nummer = i.number
);

-- ------------------------------------------------------ 2. SPALTEN
-- on delete set null und nicht cascade: eine gelöschte Anfrage darf
-- keine gebuchte Arbeitszeit mitnehmen. Zeitdaten sind sieben Jahre
-- aufzubewahren (CLAUDE.md 12.b), ein Vorgang ist es nicht.
alter table time_entry
  add column if not exists vorgang_id uuid references vorgang(id) on delete set null;
alter table stock_move
  add column if not exists vorgang_id uuid references vorgang(id) on delete set null;
alter table job_document
  add column if not exists vorgang_id uuid references vorgang(id) on delete cascade;
alter table chat_channel
  add column if not exists vorgang_id uuid references vorgang(id) on delete cascade;
alter table service_ticket
  add column if not exists vorgang_id uuid references vorgang(id) on delete set null;
alter table mail_message
  add column if not exists vorgang_id uuid references vorgang(id) on delete set null;
alter table mail_outbox
  add column if not exists vorgang_id uuid references vorgang(id) on delete set null,
  add column if not exists vorgang_dokument_id uuid references vorgang_dokument(id) on delete set null;
alter table stock_reservation
  add column if not exists vorgang_id uuid references vorgang(id) on delete cascade;

create index if not exists time_entry_vorgang_idx on time_entry (vorgang_id);
create index if not exists stock_move_vorgang_idx on stock_move (vorgang_id);
create index if not exists job_document_vorgang_idx on job_document (vorgang_id);
create index if not exists stock_reservation_vorgang_idx on stock_reservation (vorgang_id);

comment on table job_document is
  'Belege zu Vorgängen und Personaldokumente in einer Tabelle. Der Name '
  'stammt aus dem Modell vor dem Vorgang; der Bezug ist vorgang_id.';

-- ------------------------------------------------------ 3. BEFÜLLEN
update time_entry t set vorgang_id = v.id
from vorgang v where v.alt_job_id = t.job_id and t.vorgang_id is null;

update stock_move s set vorgang_id = v.id
from vorgang v where v.alt_job_id = s.job_id and s.vorgang_id is null;

update job_document d set vorgang_id = v.id
from vorgang v where v.alt_job_id = d.job_id and d.vorgang_id is null;

update chat_channel c set vorgang_id = v.id
from vorgang v where v.alt_job_id = c.job_id and c.vorgang_id is null;

update service_ticket s set vorgang_id = v.id
from vorgang v where v.alt_job_id = s.job_id and s.vorgang_id is null;

update stock_reservation r set vorgang_id = v.id
from vorgang v where v.alt_job_id = r.job_id and r.vorgang_id is null;

update mail_message m set vorgang_id = v.id
from vorgang v where v.alt_job_id = m.job_id and m.vorgang_id is null;

update mail_message m set vorgang_id = v.id
from vorgang v where v.alt_quote_id = m.quote_id and m.vorgang_id is null;

update mail_outbox o set vorgang_id = v.id
from vorgang v where v.alt_job_id = o.job_id and o.vorgang_id is null;

update mail_outbox o set vorgang_id = v.id
from vorgang v where v.alt_quote_id = o.quote_id and o.vorgang_id is null;

-- Rechnungen sind beim Übertrag zu vorgang_dokument geworden; die
-- Verbindung läuft über die Nummer, die dabei erhalten blieb.
update mail_outbox o set vorgang_dokument_id = d.id
from invoice i
join vorgang_dokument d on d.company_id = i.company_id and d.nummer = i.number
where i.id = o.invoice_id and o.vorgang_dokument_id is null;

-- --------------------------------------------------- 4. NICHTS OFFEN
-- Ein stiller Rest wäre genau die Sorte Datenverlust, die erst auffällt,
-- wenn jemand eine Zeitbuchung sucht, die es nicht mehr gibt.
do $$
declare offen int;
begin
  select count(*) into offen from time_entry
   where job_id is not null and vorgang_id is null;
  if offen > 0 then
    raise exception 'Zeitbuchungen ohne Vorgang: %', offen;
  end if;

  select count(*) into offen from stock_move
   where job_id is not null and vorgang_id is null;
  if offen > 0 then
    raise exception 'Materialbewegungen ohne Vorgang: %', offen;
  end if;

  select count(*) into offen from job_document
   where job_id is not null and vorgang_id is null;
  if offen > 0 then
    raise exception 'Dokumente ohne Vorgang: %', offen;
  end if;

  select count(*) into offen from invoice i
   where not exists (
     select 1 from vorgang_dokument d
     where d.company_id = i.company_id and d.nummer = i.number
   );
  if offen > 0 then
    raise exception 'Rechnungen ohne Beleg am Vorgang: %', offen;
  end if;
end $$;

-- -------------------------------------------------- 5. VOLLTEXTSUCHE
-- Die Befehlspalette sprang bisher auf Auftrag und Angebot. Beide
-- verschwinden; der Vorgang trägt ihre Nummern ohnehin mit.
create or replace view search_index as
  select company_id, 'customer'::text as kind, id, name as label from customer
   where deleted_at is null
  union all
  select company_id, 'article', id, sku || ' ' || name from article
  union all
  select company_id, 'vorgang', id,
         number || ' ' || coalesce(ort, '') ||
         case when alt_nummern is null then '' else ' ' || alt_nummern end
    from vorgang;

alter view search_index set (security_invoker = on);

comment on view search_index is
  'Quelle der Befehlspalette. Alte Auftrags- und Angebotsnummern stehen '
  'über vorgang.alt_nummern weiter darin — wer wegen AN-2026-0104 '
  'anruft, wird gefunden.';
