/*
 * Mitteilungen: eigene statt fremde, und live statt beim nächsten Laden.
 *
 * ZWEI PUNKTE, der erste ist der ernstere.
 *
 * 1. JEDER SAH ALLES.
 *
 * `notification` hing an der generischen Policy-Schleife aus 0001 und
 * prüfte nur `company_id`. Damit sah jeder angemeldete Mitarbeiter
 * sämtliche Mitteilungen des Betriebs — auch die, die an jemand anderen
 * adressiert sind. Nachgemessen im Demobestand: ein Monteur bekam alle
 * 137 Zeilen, der Zähler in der Leiste zeigte ihm 119 ungelesene
 * Hinweise, von denen ihn kaum einer betraf.
 *
 * Das ist nicht nur Lärm. In `notification` steht, welcher Nachweis bei
 * welchem Mitarbeiter abläuft, welche Mail an welchen Kunden nicht
 * zugestellt werden konnte, wessen Stundenabrechnung bereitliegt. Nach
 * CLAUDE.md 12.b ist der Zugriff auf fremde Personendaten an `can()`
 * gebunden — hier war er an gar nichts gebunden.
 *
 * Neu: Man sieht die eigenen Mitteilungen und die, die an den ganzen
 * Betrieb gehen (`user_id is null`). Sonst nichts.
 *
 * 2. SIE KAMEN NIE AN.
 *
 * Ohne Realtime erfährt eine offene Sitzung von einer neuen Mitteilung
 * erst beim nächsten Seitenwechsel. CLAUDE.md 4.5 nennt `notification`
 * ausdrücklich als eine der vier Tabellen, für die Realtime
 * eingeschaltet gehört — gemacht wurde es nie.
 */

-- ------------------------------------------------------------ POLICIES
drop policy if exists notification_sel on notification;
drop policy if exists notification_ins on notification;
drop policy if exists notification_upd on notification;
drop policy if exists notification_del on notification;

/*
 * Lesen: eigene und betriebsweite.
 *
 * `auth.uid()` ist dieselbe ID wie `app_user.id` — app_user hängt per
 * Fremdschlüssel an auth.users (0001). Der Umweg über eine Unterabfrage
 * auf app_user wäre also nur langsamer.
 */
create policy notification_sel on notification
  for select to authenticated
  using (
    company_id = public.current_company_id()
    and (user_id is null or user_id = auth.uid())
  );

/*
 * Ändern: nur die eigene Zeile, und faktisch nur `read_at` — alles
 * andere hat unten kein Spaltenrecht. Eine betriebsweite Mitteilung
 * (`user_id is null`) kann niemand für alle anderen als gelesen
 * markieren; sie verschwindet erst, wenn sie veraltet ist.
 */
create policy notification_upd on notification
  for update to authenticated
  using (company_id = public.current_company_id() and user_id = auth.uid())
  with check (company_id = public.current_company_id() and user_id = auth.uid());

/*
 * Löschen: die eigene. Wer eine Mitteilung wegräumt, räumt seine eigene
 * weg — eine betriebsweite bleibt für alle anderen stehen.
 */
create policy notification_del on notification
  for delete to authenticated
  using (company_id = public.current_company_id() and user_id = auth.uid());

/*
 * Anlegen: niemand aus der Anwendung heraus.
 *
 * Mitteilungen entstehen in Cron-Läufen, im Mailversand und im Portal —
 * alles Pfade mit dem Service-Role-Client. Dürfte eine angemeldete
 * Sitzung schreiben, könnte sich jeder selbst oder anderen beliebige
 * Hinweise unterschieben, und die Leiste wäre keine Auskunft mehr.
 */

-- -------------------------------------------------------- SPALTENRECHTE
/*
 * Dieselbe Lehre wie bei `vorgang_dokument` (0074): Eine Policy
 * entscheidet über die Zeile, nicht über die Spalte. Die Zeile MUSS
 * änderbar bleiben, damit man etwas als gelesen markieren kann — aber
 * Titel, Text und Verweis dürfen danach nicht mehr wandern.
 */
revoke insert, update on notification from authenticated, anon;
grant update (read_at) on notification to authenticated;

comment on table notification is
  'Hinweise an einen Mitarbeiter (user_id) oder an den ganzen Betrieb '
  '(user_id is null). Jeder sieht nur seine eigenen und die '
  'betriebsweiten (0075); geschrieben wird ausschliesslich mit dem '
  'Service-Role-Client aus Cron, Mailversand und Portal.';

-- ------------------------------------------------------------ REALTIME
/*
 * Ohne das kommt nichts an, solange die Seite offen steht.
 *
 * In einen DO-Block, weil `alter publication ... add table` fehlschlägt,
 * wenn die Tabelle schon drin ist — und ob jemand das früher einmal im
 * Dashboard geklickt hat, weiss diese Migration nicht.
 */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification'
  ) then
    alter publication supabase_realtime add table notification;
  end if;
end $$;

/*
 * Realtime liefert nur, was die Policy des Zuhörers erlaubt. Durch die
 * Select-Policy oben bekommt jede Sitzung also ausschliesslich ihre
 * eigenen Mitteilungen gemeldet — die Einschränkung oben wirkt auch
 * hier, ohne dass der Client filtern müsste.
 */
