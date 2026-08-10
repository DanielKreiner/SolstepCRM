/*
 * Der Planer bekommt einen eigenen Bereich in der Rollenmatrix.
 *
 * Warum nicht 'pipelines' mitbenutzen, wie 0060 es zunächst tat: der
 * Monteur hat dort LESERECHT — er muss seine Aufträge sehen. Damit stand
 * ihm auch der Planer offen, obwohl Briefing 10 ihn ausdrücklich
 * ausschliesst. Aufgefallen ist es im Abnahmetest 24, der für den
 * Monteur eine 404 erwartet und eine 200 bekam.
 *
 * Ein geborgtes Recht ist deshalb der falsche Weg: 'pipelines' bedeutet
 * „arbeitet an Aufträgen mit", nicht „darf Anlagen auslegen". Das sind
 * zwei Dinge, und sobald ein Betrieb sie unterschiedlich verteilen will
 * — die Bauleitung plant, das Büro nicht —, geht es mit einem
 * gemeinsamen Bereich gar nicht.
 *
 * Vorbelegung nach Briefing 10: gf, buero und bauleitung planen,
 * monteur und lager nicht. Ändern kann das jeder Betrieb selbst in den
 * Einstellungen — die Matrix ist dafür da.
 */

insert into role_permission (company_id, role, area, level)
select c.id, r.role, 'planer',
  case
    when r.role in ('gf', 'buero', 'bauleitung') then 'write'::perm_level
    else 'none'::perm_level
  end
from company c
cross join (select unnest(enum_range(null::user_role)) as role) r
on conflict (company_id, role, area) do nothing;

/*
 * Die Policies aus 0060 hängen noch an 'pipelines' und werden hier
 * umgestellt. Lesen und Schreiben trennen sich dabei: `read` reicht, um
 * eine fremde Planung anzusehen, ohne sie zu verändern.
 */
drop policy if exists planer_projekt_select on planer_projekt;
create policy planer_projekt_select on planer_projekt for select to authenticated
  using (company_id = public.current_company_id()
         and public.can('planer', 'read'));

drop policy if exists planer_projekt_write on planer_projekt;
create policy planer_projekt_write on planer_projekt for all to authenticated
  using (company_id = public.current_company_id()
         and public.can('planer', 'write'))
  with check (company_id = public.current_company_id()
              and public.can('planer', 'write')
              and public.tenant_writable());
