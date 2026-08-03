-- =====================================================================
-- 0027 — Der übernommene Verlauf war vervielfacht
--
-- 0026 hat jede contact_activity an JEDEN Vorgang desselben Kunden
-- gehängt. Bei vier Vorgängen pro Kunde wurde aus einem Telefonat vier,
-- aus 553 Kontakten 2200 Einträge. Der Aktivitätsstrom ist die zentrale
-- Anzeige des neuen Modells — mit vierfachen Einträgen ist er unbrauchbar,
-- und man traut ihm auch danach nicht mehr.
--
-- Ein Kontakt gehört zu genau einem Vorgang. Welchem, ist aus dem
-- Altbestand nicht sicher zu wissen: contact_activity kannte nur den
-- Kunden. Die beste verfügbare Annahme ist der Vorgang, der zum
-- Zeitpunkt des Kontakts der jüngste laufende war — bei einem Anruf am
-- 3. Mai ging es mit grosser Wahrscheinlichkeit um das, woran gerade
-- gearbeitet wurde.
-- =====================================================================

-- Aufräumen: alles, was aus dem Kontaktverlauf kam. Erkennbar an Typ,
-- leerem payload und den sechs Überschriften, die 0026 vergeben hat.
-- Anwendungscode schreibt noch nichts in diese Tabelle — die Oberfläche
-- dafür entsteht erst.
delete from vorgang_event
where typ = 'notiz'
  and payload = '{}'::jsonb
  and titel in ('Telefonat', 'E-Mail', 'Über das Kundenportal',
                'Notiz', 'Angebot', 'Kontakt');

-- Neu, je Kontakt genau ein Vorgang.
insert into vorgang_event (company_id, vorgang_id, typ, titel, body, created_at, created_by)
select distinct on (ca.id)
  ca.company_id,
  v.id,
  'notiz',
  case ca.kind
    when 'call' then 'Telefonat'
    when 'mail' then 'E-Mail'
    when 'portal' then 'Über das Kundenportal'
    when 'note' then 'Notiz'
    when 'quote' then 'Angebot'
    else 'Kontakt'
  end,
  ca.body,
  ca.created_at,
  ca.user_id
from contact_activity ca
join vorgang v
  on v.customer_id = ca.customer_id
 and v.company_id = ca.company_id
order by
  ca.id,
  -- Zuerst die Vorgänge, die zum Zeitpunkt des Kontakts schon existierten,
  -- davon der jüngste. Gibt es keinen, der älteste des Kunden — dann ist
  -- der Kontakt älter als jeder Vorgang und gehört an den Anfang.
  (v.created_at <= ca.created_at) desc,
  case when v.created_at <= ca.created_at then v.created_at end desc,
  v.created_at asc;

-- Gegenprobe: nicht mehr Einträge als Kontakte. Schlägt der Assert an,
-- bricht die Migration ab, statt einen falschen Stand festzuschreiben.
do $$
declare v_kontakte int; v_events int;
begin
  select count(*) into v_kontakte from contact_activity;
  select count(*) into v_events from vorgang_event
    where typ = 'notiz' and payload = '{}'::jsonb
      and titel in ('Telefonat', 'E-Mail', 'Über das Kundenportal',
                    'Notiz', 'Angebot', 'Kontakt');
  if v_events > v_kontakte then
    raise exception 'Verlauf immer noch vervielfacht: % Einträge zu % Kontakten',
      v_events, v_kontakte;
  end if;
  raise notice 'Verlauf: % Einträge zu % Kontakten', v_events, v_kontakte;
end $$;
