-- =====================================================================
-- 0008 — Personenbezogene Daten waren zu weit offen
--
-- Zwei Lücken, beide gegen CLAUDE.md 12.b ("Zugriff auf fremde Zeit-,
-- Abwesenheits- und Dokumentdaten nur mit can(...)").
--
-- 1. time_entry hing an can('zeiterfassung', ...). Diese Berechtigung
--    braucht ein Monteur aber, um überhaupt selbst zu stempeln — und
--    bekam damit die Zeiten aller Kollegen zu sehen. Nachgemessen,
--    angemeldet als Monteur: 11 Buchungen sichtbar, 3 davon von Thomas
--    Zauner.
--
--    Fremde Personendaten hängen jetzt am Bereich 'mitarbeiter'. Die
--    eigene Zeiterfassung bleibt davon unberührt: eigene Zeilen sieht man
--    über user_id = auth.uid(), und das Anlegen läuft über die generische
--    INSERT-Policy, die keine can()-Prüfung kennt.
--
-- 2. app_user.hourly_cost war für jeden Angemeldeten lesbar. Der Monteur
--    konnte die internen Stundensätze der Geschäftsführung auslesen. Das
--    ist eine Entgeltinformation und gehört nicht in die Hand jedes
--    Nutzers.
-- =====================================================================

-- ------------------------------------------------------ FREMDE ZEITEN
drop policy if exists time_entry_own on time_entry;

create policy time_entry_own on time_entry for select to authenticated
  using (
    company_id = public.current_company_id()
    and (user_id = auth.uid() or public.can('mitarbeiter', 'read'))
  );

-- Korrekturanträge tragen dieselben Daten wie die Buchung selbst.
alter table time_correction enable row level security;
drop policy if exists time_correction_sel on time_correction;

create policy time_correction_own on time_correction for select to authenticated
  using (
    company_id = public.current_company_id()
    and (user_id = auth.uid() or public.can('mitarbeiter', 'read'))
  );

-- Zeitkonto-Bewegungen ebenso.
drop policy if exists time_account_move_sel on time_account_move;

create policy time_account_move_own on time_account_move for select to authenticated
  using (
    company_id = public.current_company_id()
    and (user_id = auth.uid() or public.can('mitarbeiter', 'read'))
  );

-- Qualifikationen und Mitarbeiterdokumente sind Personalakte.
drop policy if exists qualification_sel on qualification;

create policy qualification_own on qualification for select to authenticated
  using (
    company_id = public.current_company_id()
    and (user_id = auth.uid() or public.can('mitarbeiter', 'read'))
  );

-- ----------------------------------------------------- STUNDENSÄTZE
-- Spaltenrecht statt Zeilenrecht: die Zeile selbst bleibt lesbar, damit
-- Namen, Rolle und Standort in jeder Liste stehen können.
revoke select (hourly_cost) on app_user from authenticated;

/*
 * Für Auswertungen, die den Satz wirklich brauchen (Nachkalkulation,
 * Berichte), gibt es einen geprüften Weg. Security Definer, damit die
 * Spaltensperre greift — aber mit can()-Prüfung im Rumpf.
 */
create or replace function public.hourly_cost_of(p_user uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when public.can('mitarbeiter', 'read') then u.hourly_cost
    else null
  end
  from app_user u
  where u.id = p_user
    and u.company_id = public.current_company_id()
$$;

comment on function public.hourly_cost_of is
  'Stundensatz einer Person, aber nur für Rollen mit Leserecht auf '
  'mitarbeiter. Die Spalte selbst ist für authenticated gesperrt.';

comment on column app_user.hourly_cost is
  'Interner Kostensatz. Spaltenrecht entzogen — Zugriff über '
  'public.hourly_cost_of().';
