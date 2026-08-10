/*
 * Zugriff auf den Ertrags-Cache ohne Service-Role-Key.
 *
 * Der erste Anlauf las den Cache im Route Handler mit dem Service-Key.
 * Die Lint-Regel des Projekts hat das zu Recht abgelehnt: der Key
 * umgeht RLS vollständig, und wer ihn einmal in einer normalen Route
 * zulässt, hat ihn bald in fünf weiteren.
 *
 * Der Cache lässt sich aber auch nicht einfach per Policy öffnen. Er
 * ist mandantenübergreifend und hat keinen company_id — eine
 * Schreibpolicy für `authenticated` hiesse, dass jeder angemeldete
 * Benutzer Ertragswerte für beliebige Standorte hinterlegen könnte, die
 * dann anderen Betrieben als PVGIS-Wert angezeigt würden.
 *
 * Zwei eng geschnittene Funktionen lösen beides: sie laufen mit den
 * Rechten des Eigentümers, prüfen aber selbst das Planer-Leserecht und
 * lassen nur genau die zwei nötigen Operationen zu.
 */

create or replace function public.planer_ertrag_cache_lesen(p_schluessel text)
returns table (spezifisch numeric, monate numeric[])
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can('planer', 'read') then
    raise exception 'Kein Zugriff auf den Planer.' using errcode = '42501';
  end if;

  return query
    select c.spezifisch, c.monate
    from planer_ertrag_cache c
    where c.schluessel = p_schluessel
      and c.laeuft_ab > now();
end $$;

comment on function public.planer_ertrag_cache_lesen is
  'Gecachten PVGIS-Wert lesen. Abgelaufene Einträge liefert sie nicht — '
  'der Aufrufer holt dann frisch.';

create or replace function public.planer_ertrag_cache_merken(
  p_schluessel text,
  p_spezifisch numeric,
  p_monate numeric[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can('planer', 'read') then
    raise exception 'Kein Zugriff auf den Planer.' using errcode = '42501';
  end if;

  /*
   * Grobe Plausibilität, damit über diesen Weg kein Unsinn in den
   * gemeinsamen Cache gelangt: Unter 100 und über 2.500 kWh/kWp liegt
   * in Mitteleuropa kein Dach, und zwölf Monatswerte müssen es sein.
   */
  if p_spezifisch is null or p_spezifisch <= 100 or p_spezifisch > 2500 then
    raise exception 'Unplausibler Ertragswert: %', p_spezifisch using errcode = '22003';
  end if;
  if array_length(p_monate, 1) is distinct from 12 then
    raise exception 'Es müssen zwölf Monatswerte sein.' using errcode = '22023';
  end if;

  insert into planer_ertrag_cache (schluessel, spezifisch, monate, abgerufen_am, laeuft_ab)
  values (p_schluessel, p_spezifisch, p_monate, now(), now() + interval '90 days')
  on conflict (schluessel) do update
    set spezifisch = excluded.spezifisch,
        monate = excluded.monate,
        abgerufen_am = excluded.abgerufen_am,
        laeuft_ab = excluded.laeuft_ab;
end $$;

comment on function public.planer_ertrag_cache_merken is
  'Frisch geholten PVGIS-Wert im gemeinsamen Cache ablegen, mit '
  'Plausibilitätsprüfung.';

revoke all on function public.planer_ertrag_cache_lesen(text) from public;
revoke all on function public.planer_ertrag_cache_merken(text, numeric, numeric[]) from public;
grant execute on function public.planer_ertrag_cache_lesen(text) to authenticated;
grant execute on function public.planer_ertrag_cache_merken(text, numeric, numeric[]) to authenticated;
