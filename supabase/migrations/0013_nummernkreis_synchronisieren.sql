-- =====================================================================
-- 0013 — Nummernkreis lief in bereits vergebene Nummern
--
-- Gefunden über einen E2E-Test, der ein Anliegen aus dem Kundenportal
-- anlegt:
--
--   duplicate key value violates unique constraint
--   "service_ticket_company_id_number_key"
--
-- Ursache: doc_counter stand für 'ticket' auf 30, während S-2026-0030 und
-- S-2026-0031 längst existierten. Wer Belege mit fertigen Nummern einfügt —
-- der Seed tut das, und der CSV-Import für Altbestände (CLAUDE.md 12.a)
-- wird es auch tun —, zählt den Zähler nicht mit. Irgendwann holt der
-- Zähler die eingefügten Nummern ein und next_number() liefert eine
-- Nummer, die es schon gibt.
--
-- Das ist kein Testartefakt. Genau dieser Ablauf steht im Onboarding:
-- "CSV-Import für Kunden, Artikel, offene Aufträge, Mitarbeiter". Ein
-- Betrieb, der seine 400 offenen Aufträge mitbringt, kann sonst am ersten
-- Tag keine Rechnung schreiben.
--
-- Lücken sind erlaubt, Duplikate nicht (CLAUDE.md 5.6) — deshalb wird der
-- Zähler angehoben, nie gesenkt.
-- =====================================================================

create or replace function public.sync_doc_counter(
  p_company uuid,
  p_kind text,
  p_year int default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_year   int  := coalesce(p_year, extract(year from (now() at time zone 'Europe/Vienna'))::int);
  v_table  text;
  v_prefix text;
  v_max    int;
  v_ist    int;
begin
  select t, p into v_table, v_prefix from (values
    ('quote',          'quote',          'AN'),
    ('job',            'job',            'A'),
    ('invoice',        'invoice',        'RE'),
    ('ticket',         'service_ticket', 'S'),
    ('purchase_order', 'purchase_order', 'B')
  ) as m(k, t, p) where m.k = p_kind;

  if v_table is null then
    raise exception 'Unbekannte Belegart: %', p_kind;
  end if;

  -- Höchste bereits vergebene laufende Nummer dieses Jahres.
  execute format(
    'select coalesce(max(nullif(regexp_replace(number, ''^%s-%s-'', ''''), '''')::int), 0)
       from %I where company_id = $1 and number like %L',
    v_prefix, v_year, v_table, v_prefix || '-' || v_year || '-%'
  ) into v_max using p_company;

  insert into doc_counter(company_id, kind, year, value)
  values (p_company, p_kind, v_year, v_max)
  on conflict (company_id, kind, year)
    -- greatest: der Zähler wird angehoben, nie gesenkt. Ein Rollback hat
    -- Lücken hinterlassen, und die sind erlaubt — sie wieder aufzufüllen
    -- würde Duplikate erzeugen.
    do update set value = greatest(doc_counter.value, excluded.value)
  returning value into v_ist;

  return v_ist;
end $$;

comment on function public.sync_doc_counter(uuid, text, int) is
  'Hebt den Nummernkreis auf die höchste bereits vergebene Nummer an. '
  'Nach jedem Import fremder Belegnummern aufzurufen, sonst kollidiert '
  'next_number() später.';

-- Einmalig für den Bestand: alle Mandanten, alle Belegarten, alle Jahre,
-- die in den Daten vorkommen.
do $$
declare c record;
begin
  for c in
    select id from company
  loop
    perform public.sync_doc_counter(c.id, k, y)
    from unnest(array['quote','job','invoice','ticket','purchase_order']) as k,
         generate_series(
           extract(year from now())::int - 1,
           extract(year from now())::int + 1
         ) as y;
  end loop;
end $$;
