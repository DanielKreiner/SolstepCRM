-- =====================================================================
-- 0009 — Die Spaltensperre aus 0008 hat nicht gegriffen
--
-- REVOKE SELECT (spalte) entfernt nichts, solange ein Recht auf die ganze
-- Tabelle besteht: ein Tabellen-GRANT deckt alle Spalten ab, auch
-- künftige. Die Sperre aus 0008 lief deshalb ins Leere — nachgemessen,
-- der Monteur konnte hourly_cost weiterhin lesen.
--
-- Richtig ist der umgekehrte Weg: das Tabellenrecht entziehen und
-- ausschließlich die unbedenklichen Spalten einzeln gewähren.
--
-- Preis dieser Lösung: eine neue Spalte auf app_user ist zunächst für
-- niemanden lesbar. Das ist beabsichtigt — bei Personendaten ist die
-- stille Voreinstellung "sichtbar" der falsche Weg herum.
-- =====================================================================

revoke select on app_user from authenticated;

grant select (
  id, company_id, location_id, name, email, phone, role,
  weekly_hours, employment_type, vacation_days_year, vacation_carry,
  avatar_path, active, created_at
) on app_user to authenticated;

comment on column app_user.hourly_cost is
  'Interner Kostensatz. Kein Spaltenrecht für authenticated — Zugriff '
  'ausschließlich über public.hourly_cost_of(), das can(mitarbeiter) prüft.';

-- ---------------------------------------------------------- ROLLENMATRIX
-- Nach 0008 hängen fremde Personendaten am Bereich 'mitarbeiter'. Die
-- Bauleitung führt eine Partie und muss deren Zeiten sehen — ohne diesen
-- Eintrag sähe sie nach dem Fix nur noch die eigenen. Für neue Mandanten
-- steht derselbe Wert in seed.sql.
insert into role_permission (company_id, role, area, level)
select c.id, 'bauleitung'::user_role, 'mitarbeiter', 'read'::perm_level
from company c
on conflict (company_id, role, area) do update
  set level = case
    when role_permission.level = 'none' then excluded.level
    else role_permission.level
  end;
