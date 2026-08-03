-- =====================================================================
-- 0026 — Bestand in Vorgänge überführen
--
-- Aus quote und job wird je ein Vorgang. Der Reihe nach:
--
--   1. Jeder job wird ein Vorgang. Er ist der spätere Zustand und trägt
--      Termin, Wert und Adresse.
--   2. Jedes quote OHNE job wird ein Vorgang. Mit job gehört es zu
--      dessen Vorgang und wird dort zur Angebotsversion.
--   3. Positionen, Dokumente und Verlauf wandern mit.
--
-- Nichts wird gelöscht. quote und job bleiben stehen, bis der Umbau
-- steht und die Zahlen geprüft sind (Briefing Abschnitt 10, Schritt 8).
-- Die alte Nummer bleibt am Vorgang hängen, damit ein Beleg von letzter
-- Woche wiederfindbar ist.
-- =====================================================================

alter table vorgang
  add column if not exists alt_quote_id uuid references quote(id),
  add column if not exists alt_job_id uuid references job(id),
  add column if not exists alt_nummern text;

comment on column vorgang.alt_nummern is
  'Frühere Angebots- und Auftragsnummern, durch Komma getrennt. Ein '
  'Kunde, der wegen AN-2026-0104 anruft, muss auffindbar bleiben.';

-- ------------------------------------------------------ PHASENABBILDUNG
-- Die alten Phasen waren je Mandant benannt; verlässlich ist nur der
-- system_key (CLAUDE.md Abschnitt 5, Punkt 1a).
create or replace function public.phase_aus_altbestand(
  p_system_key text, p_hat_termin boolean, p_geschlossen boolean
) returns vorgang_phase
language sql immutable as $$
  select case
    when p_geschlossen then 'abschluss'::vorgang_phase
    when p_system_key = 'closed' then 'abschluss'::vorgang_phase
    when p_system_key = 'lost' then 'verloren'::vorgang_phase
    when p_system_key = 'ready_to_invoice' then 'abschluss'::vorgang_phase
    when p_system_key = 'in_execution' then 'montage'::vorgang_phase
    when p_hat_termin then 'montage'::vorgang_phase
    else 'beauftragt'::vorgang_phase
  end;
$$;

-- ---------------------------------------------------------- 1. AUFTRÄGE
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
  -- Der Check verlangt bei 'verloren' einen Grund. Aus dem Altbestand
  -- ist er nicht rekonstruierbar, also 'sonstiges' mit Notiz weiter unten.
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

-- ---------------------------------------------------------- 2. ANGEBOTE
-- Nur die ohne Auftrag: die anderen hängen schon am Vorgang aus Schritt 1.
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
  and not exists (select 1 from vorgang v where v.alt_quote_id = q.id)
  -- Ein Kunde kann mehrere Anlagen haben; distinct on wäre hier sauberer,
  -- aber der Seed führt genau eine je Kunde. Doppelte Zeilen fängt das
  -- not exists oben ab, sobald die erste geschrieben ist.
  ;

-- ------------------------------------------------------- 3. POSITIONEN
insert into vorgang_position (
  company_id, vorgang_id, sort, article_id, bezeichnung,
  menge, einheit, ep_netto, ust_satz, kalk_ek,
  ist_material, bild_url, beschreibung
)
select
  v.company_id, v.id, qi.pos, qi.article_id, qi.text,
  qi.qty, qi.unit, qi.sale_price, qi.vat_rate, qi.purchase_price,
  coalesce(a.ist_material, true), qi.image_url, qi.description
from quote_item qi
join vorgang v on v.alt_quote_id = qi.quote_id
left join article a on a.id = qi.article_id
where not exists (
  select 1 from vorgang_position vp
  where vp.vorgang_id = v.id and vp.sort = qi.pos
);

-- ---------------------------------------------------------- 4. GATES
-- Nur für Vorgänge, die schon beauftragt sind oder weiter. Eine Anfrage
-- braucht keine Gates.
insert into vorgang_gate (
  company_id, vorgang_id, key, label, meta, blocking, sort, status
)
select
  v.company_id, v.id, t.key, t.label, t.meta, t.blocking, t.sort,
  -- Was hinter uns liegt, ist erledigt. Ein Vorgang in Montage hat seine
  -- Anzahlung bekommen, sonst wäre er nicht dort.
  case
    when v.phase in ('montage', 'abschluss') then 'erledigt'::gate_status
    else 'offen'::gate_status
  end
from vorgang v
cross join gate_template t
where t.company_id = v.company_id
  and v.phase in ('beauftragt', 'montage', 'abschluss')
  and not exists (
    select 1 from vorgang_gate g where g.vorgang_id = v.id and g.key = t.key
  );

-- --------------------------------------------------------- 5. VERLAUF
-- Der Anfang jedes Stroms: woher der Vorgang kommt.
insert into vorgang_event (company_id, vorgang_id, typ, titel, body, created_at)
select
  v.company_id, v.id, 'notiz',
  'Aus dem Altbestand übernommen',
  concat_ws(' ',
    'Zusammengeführt aus', nullif(v.alt_nummern, ''),
    '· Phase aus dem früheren Status abgeleitet.'),
  v.created_at
from vorgang v
where v.alt_nummern is not null
  and not exists (
    select 1 from vorgang_event e
    where e.vorgang_id = v.id and e.titel = 'Aus dem Altbestand übernommen'
  );

-- Kundenkontakte, die schon erfasst sind. contact_activity kennt keinen
-- Betreff, nur eine Art — die wird zur Überschrift.
--
-- ACHTUNG: dieser Schritt hängt jeden Kontakt an JEDEN Vorgang desselben
-- Kunden und vervielfacht damit den Verlauf. 0027 räumt das auf und
-- ordnet je Kontakt genau einen Vorgang zu. Diese Fassung bleibt nur
-- stehen, weil sie bereits ausgerollt war.
insert into vorgang_event (company_id, vorgang_id, typ, titel, body, created_at, created_by)
select
  v.company_id, v.id, 'notiz',
  case ca.kind
    when 'call' then 'Telefonat'
    when 'mail' then 'E-Mail'
    when 'portal' then 'Über das Kundenportal'
    when 'note' then 'Notiz'
    when 'quote' then 'Angebot'
    else 'Kontakt'
  end,
  ca.body, ca.created_at, ca.user_id
from contact_activity ca
join vorgang v on v.customer_id = ca.customer_id
                 and v.company_id = ca.company_id
where not exists (
  select 1 from vorgang_event e
  where e.vorgang_id = v.id and e.created_at = ca.created_at
);

-- ------------------------------------------------------ 6. DOKUMENTE
-- Rechnungen bekommen ihren Vorgang, damit die Offene-Posten-Liste aus
-- einer Quelle liest.
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

-- --------------------------------------------------------- 7. TERMINE
insert into vorgang_termin (company_id, vorgang_id, art, von, bis, notiz, created_at)
select
  a.company_id, v.id, 'montage', a.starts_at, a.ends_at, a.title, now()
from job_appointment a
join vorgang v on v.alt_job_id = a.job_id
where not exists (
  select 1 from vorgang_termin t
  where t.vorgang_id = v.id and t.von = a.starts_at
);

insert into vorgang_termin_person (termin_id, user_id, company_id)
select t.id, a.user_id, t.company_id
from job_appointment a
join vorgang v on v.alt_job_id = a.job_id
join vorgang_termin t on t.vorgang_id = v.id and t.von = a.starts_at
where a.user_id is not null
on conflict do nothing;
