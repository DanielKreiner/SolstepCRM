-- Der automatische Pausenabzug muss im Saldo ankommen.
--
-- 0021 hat die Spalte angelegt, aber v_time_balance summierte weiter die
-- volle erfasste Dauer — der Abzug wäre eine Zahl ohne Wirkung geblieben.
-- Nachgereicht als eigene Migration, weil 0021 bereits ausgerollt war
-- (CLAUDE.md 12.a: keine angewandte Migration nachträglich ändern).
--
-- duration_min bleibt die erfasste Dauer: der Eintrag zeigt, was
-- tatsächlich gestempelt wurde, der Saldo, was davon zählt.

-- Der automatische Pausenabzug muss im Saldo ankommen, sonst ist er eine
-- Zahl ohne Wirkung. duration_min bleibt die erfasste Dauer — der Abzug
-- wird erst hier abgezogen, damit der Eintrag zeigt, was tatsächlich
-- gestempelt wurde, und der Saldo, was davon zählt.
create or replace view v_time_balance as
select u.id as user_id, u.company_id,
       coalesce(sum(te.duration_min - te.auto_break_min)
                filter (where te.kind in ('work','travel','training')), 0) as actual_min,
       coalesce((select sum(m.minutes) from time_account_move m where m.user_id = u.id), 0) as adjust_min
from app_user u
left join time_entry te on te.user_id = u.id and te.status in ('booked','approved')
group by u.id;

alter view public.v_time_balance set (security_invoker = on);
