/*
 * Nummernkreise: Startwert setzen, und den Abgleich reparieren.
 *
 * ZWEI PUNKTE.
 *
 * 1. EIN BETRIEB KANN SEINE NUMMERIERUNG NICHT FORTSETZEN.
 *
 * Die Einstellungen zeigten die Zählerstände an und schrieben dazu
 * "bewusst nicht editierbar: eine zurückgesetzte Reihe erzeugt doppelte
 * Belegnummern". Der Satz stimmt — für das Senken. Für das Anheben
 * stimmt er nicht, und genau das braucht jeder Betrieb, der aus einer
 * anderen Software kommt: Steht die Buchhaltung bei RE-2026-0312, darf
 * die erste Rechnung hier nicht RE-2026-0001 heissen. Nachträglich
 * geradebiegen lässt sich das nicht, ohne eine Nummer zweimal zu
 * vergeben.
 *
 * `set_number_start` hebt den Zähler an und weigert sich, ihn zu senken.
 * Die Regel sitzt in der Datenbank und nicht in der Serveraktion: 0072
 * hat `doc_counter` für angemeldete Sitzungen vollständig gesperrt,
 * damit ausschliesslich geprüfte Funktionen daran schreiben. Das bleibt
 * so.
 *
 * 2. DER ABGLEICH ZEIGTE INS LEERE.
 *
 * `sync_doc_counter` aus 0013 sucht die höchste vergebene Nummer in den
 * Tabellen `quote`, `job`, `invoice` und `purchase_order`. Die gibt es
 * seit 0039 nicht mehr — der Bestand liegt in `vorgang`,
 * `vorgang_dokument` und `bestellung`, und die Spalte heisst dort
 * teilweise `nummer` statt `number`. Die Funktion lief damit entweder in
 * einen Fehler oder, schlimmer, auf eine Belegart, die sie gar nicht
 * mehr findet. Sie wird hier auf den heutigen Stand gebracht.
 */

/* ------------------------------------------------- Wo welche Nummer steht */
/*
 * Eine Stelle für die Zuordnung, von beiden Funktionen benutzt. Sonst
 * laufen die beiden beim nächsten Umbau auseinander, und das fällt erst
 * auf, wenn eine Nummer doppelt vergeben wurde.
 */
create or replace function public.beleg_quelle(p_kind text)
returns table (tabelle text, spalte text, praefix text)
language sql immutable as $$
  select t, s, p from (values
    ('vorgang',        'vorgang',           'number', 'V'),
    ('invoice',        'vorgang_dokument',  'nummer', 'RE'),
    ('ticket',         'service_ticket',    'number', 'S'),
    ('purchase_order', 'bestellung',        'nummer', 'B')
  ) as m(k, t, s, p) where m.k = p_kind;
$$;

comment on function public.beleg_quelle(text) is
  'Zu einer Belegart: Tabelle, Spalte und Präfix der vergebenen Nummern. '
  'Muss zu den Präfixen in next_number passen (0025).';

/* --------------------------------------------------------------- Abgleich */
create or replace function public.sync_doc_counter(
  p_company uuid,
  p_kind text,
  p_year int default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_year   int := coalesce(p_year, extract(year from (now() at time zone 'Europe/Vienna'))::int);
  v_q      record;
  v_max    int;
  v_ist    int;
begin
  select * into v_q from public.beleg_quelle(p_kind);
  if v_q.tabelle is null then
    raise exception 'Unbekannte Belegart: %', p_kind;
  end if;

  /* Höchste bereits vergebene laufende Nummer dieses Jahres. */
  execute format(
    'select coalesce(max(nullif(regexp_replace(%I, ''^%s-%s-'', ''''), '''')::int), 0)
       from %I where company_id = $1 and %I like %L',
    v_q.spalte, v_q.praefix, v_year, v_q.tabelle, v_q.spalte,
    v_q.praefix || '-' || v_year || '-%'
  ) into v_max using p_company;

  insert into doc_counter(company_id, kind, year, value)
  values (p_company, p_kind, v_year, v_max)
  on conflict (company_id, kind, year)
    /*
     * greatest: der Zähler wird angehoben, nie gesenkt. Ein Rollback hat
     * Lücken hinterlassen, und die sind erlaubt — sie wieder aufzufüllen
     * würde Duplikate erzeugen.
     */
    do update set value = greatest(doc_counter.value, excluded.value)
  returning value into v_ist;

  return v_ist;
end $$;

/* ------------------------------------------------------------- Startwert */
/**
 * Die nächste zu vergebende Nummer festlegen.
 *
 * `p_next` ist die Nummer, die der NÄCHSTE Beleg bekommen soll — also
 * das, was der Betrieb vor sich sieht, wenn er in seine bisherige
 * Rechnungsnummer schaut. Gespeichert wird p_next - 1, weil
 * `next_number` vor der Ausgabe hochzählt.
 *
 * Abgewiesen wird jeder Wert, der kleiner oder gleich einer schon
 * vergebenen Nummer ist. Geprüft wird gegen beides: den Zählerstand UND
 * den tatsächlichen Bestand. Der Zähler allein genügt nicht — fehlt
 * seine Zeile, etwa nach einer Übernahme, stünde er auf null, während
 * die Belege längst da sind.
 */
create or replace function public.set_number_start(
  p_kind text,
  p_next int,
  p_year int default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_year    int  := coalesce(p_year, extract(year from (now() at time zone 'Europe/Vienna'))::int);
  v_q       record;
  v_max     int;
  v_stand   int;
  v_grenze  int;
begin
  if v_company is null then
    raise exception 'Kein Mandant in der Sitzung.';
  end if;
  if not public.tenant_writable() then
    raise exception 'Der Zugang ist derzeit nur lesend.';
  end if;
  if not public.can('einstellungen', 'write') then
    raise exception 'Keine Berechtigung für Einstellungen.';
  end if;

  select * into v_q from public.beleg_quelle(p_kind);
  if v_q.tabelle is null then
    raise exception 'Unbekannte Belegart: %', p_kind;
  end if;

  if p_next is null or p_next < 1 or p_next > 999999 then
    raise exception 'Die nächste Nummer muss zwischen 1 und 999999 liegen.';
  end if;

  execute format(
    'select coalesce(max(nullif(regexp_replace(%I, ''^%s-%s-'', ''''), '''')::int), 0)
       from %I where company_id = $1 and %I like %L',
    v_q.spalte, v_q.praefix, v_year, v_q.tabelle, v_q.spalte,
    v_q.praefix || '-' || v_year || '-%'
  ) into v_max using v_company;

  select coalesce(value, 0) into v_stand
    from doc_counter
   where company_id = v_company and kind = p_kind and year = v_year;

  v_grenze := greatest(coalesce(v_stand, 0), v_max);

  if p_next <= v_grenze then
    raise exception
      'Nummer % ist bereits vergeben oder überholt. Die nächste freie Nummer ist %.',
      p_next, v_grenze + 1;
  end if;

  insert into doc_counter(company_id, kind, year, value)
  values (v_company, p_kind, v_year, p_next - 1)
  on conflict (company_id, kind, year) do update set value = p_next - 1;

  return format('%s-%s-%s', v_q.praefix, v_year, lpad(p_next::text, 4, '0'));
end $$;

comment on function public.set_number_start(text, int, int) is
  'Setzt die nächste zu vergebende Belegnummer. Hebt nur an, senkt nie — '
  'eine gesenkte Reihe vergibt Nummern ein zweites Mal. Geprüft wird '
  'gegen Zählerstand und tatsächlichen Bestand (0076).';

revoke all on function public.set_number_start(text, int, int) from public, anon;
grant execute on function public.set_number_start(text, int, int) to authenticated;
