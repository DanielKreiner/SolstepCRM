/*
 * Alt-Zeiten bekommen ihren Einsatz.
 *
 * Seit dem Zeiten-Umbau gilt: eine Zeit ohne Einsatz gehört niemandem.
 * Wer ohne Plan arbeitet, legt beim Stempeln einen internen Einsatz an —
 * aber alles, was vor dieser Regel gebucht wurde, hängt an nichts. In der
 * Tagesansicht steht dort "ohne Einsatz", und die Plausibilitätsprüfung
 * meldet jede dieser Buchungen als ungeklärt. Solange das so bleibt, ist
 * die Warnung wertlos: wenn hundert Zeilen auffällig sind, sieht niemand
 * mehr die eine, die es wirklich ist.
 *
 * Zwei Schritte, in dieser Reihenfolge:
 *
 * 1. Passt eine Buchung zeitlich in einen geplanten Einsatz derselben
 *    Person, wird sie dort eingehängt. Das ist die richtige Zuordnung
 *    und keine Krücke — die Zeit ist auf dieser Baustelle entstanden.
 *
 * 2. Für den Rest entsteht je Person und Tag EIN Sammel-Einsatz
 *    art='intern' mit dem Titel "Migration Altdaten". Bewusst nicht je
 *    Buchung: ein Einsatz je Zeile wäre eine Verdopplung der Tabelle
 *    ohne einen Erkenntnisgewinn. Und bewusst als 'intern' — die
 *    Buchungen behalten ihren vorgang_id, wo sie einen hatten, aber
 *    einen Auftragseinsatz zu erfinden, den es nie gab, wäre eine
 *    Behauptung über die Vergangenheit.
 *
 * Der Titel ist nachher erkennbar: wer die Zeiten prüft, sieht sofort,
 * dass die Zuordnung nachträglich entstanden ist und nicht geplant war.
 *
 * Danach der Konsistenz-Check: keine Zeit ohne Einsatz. Er ist als
 * Exception ausgeführt, damit die Migration abbricht statt still eine
 * Lücke zu lassen.
 */

/* ---------------------------------------------- 1. Passender Einsatz */

update time_entry t
   set einsatz_id = e.id
  from einsatz e
 where t.einsatz_id is null
   and t.status <> 'replaced'
   and e.company_id = t.company_id
   and exists (
     select 1 from einsatz_person ep
      where ep.einsatz_id = e.id and ep.user_id = t.user_id
   )
   /* Überlappung, nicht Enthaltensein: wer zehn Minuten früher kommt,
    * gehört trotzdem zu diesem Einsatz. */
   and e.von <= coalesce(t.ended_at, t.started_at)
   and e.bis >= t.started_at;

/* ------------------------------------------- 2. Sammel-Einsatz je Tag */

with offen as (
  select distinct
         company_id,
         user_id,
         (started_at at time zone 'Europe/Vienna')::date as tag
    from time_entry
   where einsatz_id is null
     and status <> 'replaced'
),
neu as (
  insert into einsatz (company_id, art, titel, von, bis)
  select o.company_id,
         'intern',
         'Migration Altdaten',
         (o.tag::text || ' 00:00')::timestamp at time zone 'Europe/Vienna',
         (o.tag::text || ' 23:59')::timestamp at time zone 'Europe/Vienna'
    from offen o
  returning id, company_id, von
)
insert into einsatz_person (einsatz_id, user_id, company_id)
select n.id, o.user_id, o.company_id
  from neu n
  join offen o
    on o.company_id = n.company_id
   and o.tag = (n.von at time zone 'Europe/Vienna')::date;

update time_entry t
   set einsatz_id = e.id
  from einsatz e
  join einsatz_person ep on ep.einsatz_id = e.id
 where t.einsatz_id is null
   and t.status <> 'replaced'
   and e.titel = 'Migration Altdaten'
   and e.company_id = t.company_id
   and ep.user_id = t.user_id
   and (e.von at time zone 'Europe/Vienna')::date
     = (t.started_at at time zone 'Europe/Vienna')::date;

/* ------------------------------------------------ 3. Konsistenz-Check */

do $$
declare
  rest int;
begin
  select count(*) into rest
    from time_entry
   where einsatz_id is null
     and status <> 'replaced';

  if rest > 0 then
    raise exception
      'Migration unvollständig: % Zeitbuchungen haben weiterhin keinen Einsatz.', rest;
  end if;
end $$;
