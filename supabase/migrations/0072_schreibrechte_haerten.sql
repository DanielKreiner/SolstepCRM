-- =====================================================================
-- 0072 — Die Schreibseite der Alttabellen hing an der generischen Schleife
--
-- Die Policy-Schleife aus 0001 (Zeilen 811-836) gibt JEDER Tabelle mit
-- company_id vier Policies, und die drei schreibenden prüfen nur
-- `company_id = current_company_id()`. Für alles, was nach 0001 neu
-- dazugekommen ist, haben die späteren Migrationen das nachgezogen
-- (0048, 0051, 0060, 0063, 0066). Die Tabellen aus 0001 standen noch
-- auf der Schleife — und damit stand jede von ihnen jedem angemeldeten
-- Nutzer des Mandanten offen, unabhängig von seiner Rolle.
--
-- Fünf Wege waren konkret begehbar, alle mit dem anon-Client aus der
-- Browserkonsole, ohne die Anwendung zu benutzen:
--
--   1. `update app_user set role = 'gf' where id = <eigene id>` —
--      Rechteausweitung. Danach lieferte /api/export/tenant (prüft nur
--      `me.role !== 'gf'`) den vollständigen Mandanten als ZIP:
--      Personalakten, Rechnungen, Kundenstamm.
--   2. `update role_permission set level = 'write' where role='monteur'` —
--      dasselbe Ziel über die andere Tür. public.can() wertet genau diese
--      Tabelle aus, die Wirkung ist sofort und ohne Neuanmeldung da.
--   3. `insert into time_account_move (...)` — Zeitgutschrift für sich
--      selbst, unmittelbar lohnrelevant. Dazu `update invoice` (gegen
--      CLAUDE.md 6.4 "revisionssicher") und `insert into absence` für
--      Kollegen.
--   4. `update pipeline_phase set system_key = ...` — die fünf
--      Systemsemantiken sind das, woran die Automatiken hängen
--      (CLAUDE.md 5.1a). Wer sie verschiebt, löst Rechnungen aus.
--   5. `insert into mail_outbox` — der Cron `mail-send` stellt jede Zeile
--      mit status='queued' zu. Beliebige Mail aus dem Firmenpostfach,
--      im Namen des Betriebs.
--
-- Dazu drei Lücken ohne Schreibbezug:
--
--   6. Der Bucket `documents` gab Dateien allein nach dem ersten
--      Pfadsegment frei. 0010 hat die ZEILE in job_document abgedichtet,
--      die DATEI nicht: `storage.from('documents').list()` plus signierte
--      URL lieferte fremde Verträge und Lohnzettel.
--   7. Die DELETE-Policies prüfen tenant_writable() nicht. Bei DELETE
--      gibt es keine with-check-Klausel, die das nachholt — ein Mandant
--      im Zustand `readonly` konnte löschen. CLAUDE.md 12.a: "Bei
--      readonly bleibt alles lesbar und exportierbar, nichts wird
--      gelöscht."
--   8. `absence.note` stand neben `kind='sick'` ohne Constraint. Die
--      Oberfläche blendet das Feld aus, ein direkter Insert nicht —
--      und ein Krankheitsgrund im Freitext ist ein Gesundheitsdatum
--      nach Art. 9 DSGVO (CLAUDE.md 12.b: "Kein Feld dafür bauen").
--
-- Leitlinie dieser Migration: jede Verschärfung bildet genau das ab, was
-- der Anwendungscode heute tut — nicht mehr und nicht weniger. Eine
-- Migration, die morgen früh den Mailversand oder das Stempeln abschaltet,
-- wäre schlimmer als die Lücke. Wo die Grenze enger sein müsste als der
-- Code sie heute braucht, steht das im Kommentar und nicht in der Policy.
-- =====================================================================


-- ========================================================== 1. ROLLE IM JWT
/*
 * public.current_role_name() liest die Rolle aus
 * `auth.jwt() -> app_metadata -> role`, public.can() baut darauf auf.
 * Die Admin-API schreibt sie dort (lib/onboarding/user.ts, rolleSetzen) —
 * aber lib/session.ts hat sie bis jetzt aus der TABELLE app_user gelesen.
 * Das war der Hebel aus Lücke 1: dieselbe Angabe an zwei Orten, einer
 * davon vom Nutzer beschreibbar.
 *
 * lib/session.ts liest ab jetzt app_metadata. Damit das für den Bestand
 * nicht ins Leere läuft, wird hier nachgezogen, was fehlt. Der
 * Rückfall auf app_user.role bleibt im Code bestehen — nach Abschnitt 2
 * kann diese Spalte nur noch die Geschäftsführung ändern, der Rückfall
 * ist damit keine offene Tür mehr.
 *
 * Wirkung erst beim nächsten Token: ein ausgestelltes Access-Token wird
 * dadurch nicht ungültig, die Angabe wandert beim Refresh (max. 1 Stunde)
 * in den neuen Satz Claims. Für die Lücke ist das unerheblich — sie wird
 * in Abschnitt 2 in der Datenbank geschlossen, nicht im JWT.
 */
do $$
declare
  v_fehlend int;
  v_gesetzt int;
begin
  select count(*) into v_fehlend
  from auth.users u
  join public.app_user a on a.id = u.id
  where coalesce(u.raw_app_meta_data ->> 'role', '') = ''
     or coalesce(u.raw_app_meta_data ->> 'company_id', '') = '';

  update auth.users u
     set raw_app_meta_data =
           coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('role', a.role::text,
                                 'company_id', a.company_id::text)
    from public.app_user a
   where a.id = u.id
     and (coalesce(u.raw_app_meta_data ->> 'role', '') = ''
          or coalesce(u.raw_app_meta_data ->> 'company_id', '') = '');

  get diagnostics v_gesetzt = row_count;

  raise notice '0072: % Konten ohne role/company_id in app_metadata, % ergänzt.',
    v_fehlend, v_gesetzt;
exception
  when insufficient_privilege then
    raise warning '0072: auth.users nicht beschreibbar (%). Fehlende Rollen '
                  'bitte über die Admin-API nachziehen — bis dahin greift in '
                  'lib/session.ts der Rückfall auf app_user.role.', sqlerrm;
end $$;

/*
 * Zum Nachsehen nach dem Einspielen (liefert idealerweise 0 Zeilen):
 *
 *   select a.email, a.role as tabelle, u.raw_app_meta_data ->> 'role' as jwt
 *   from public.app_user a join auth.users u on u.id = a.id
 *   where coalesce(u.raw_app_meta_data ->> 'role','') is distinct from a.role::text;
 */


-- ============================================================= 2. APP_USER
/*
 * Lücke 1. Entzogen war bisher nur `select` (0009), nie `update` oder
 * `delete` — und ein Tabellenrecht deckt alle Spalten ab, auch künftige.
 * Derselbe Weg wie in 0009: das Tabellenrecht fällt, einzelne Spalten
 * kommen gezielt zurück.
 *
 * Zurück kommt genau, was app/(app)/mitarbeiter/actions.ts schreibt
 * (mitarbeiterSpeichern, mitarbeiterAktivSetzen). Nicht dabei:
 * id, company_id, email, avatar_path, qualifikationen, created_at — die
 * schreibt heute niemand über eine angemeldete Sitzung, und bei
 * Personendaten ist die stille Voreinstellung "beschreibbar" der falsche
 * Weg herum. Wer eine dieser Spalten pflegbar macht (etwa die
 * Qualifikationen aus 0048), nimmt sie hier mit auf — sonst meldet
 * Postgres "permission denied for column".
 *
 * `role` ist der unangenehme Fall. Sauber wäre, die Spalte gar nicht zu
 * gewähren — aber mitarbeiterSpeichern schickt sie in jedem UPDATE mit,
 * auch wenn sie unverändert bleibt, und Postgres prüft Spaltenrechte
 * gegen die SET-Liste und nicht gegen die Werte. Ohne das Recht wäre
 * damit nicht die Rollenänderung gesperrt, sondern jedes Speichern eines
 * Mitarbeiters. Deshalb: Spaltenrecht ja, aber die Policy lässt nur
 * Rollen mit Schreibrecht auf 'mitarbeiter' überhaupt an die Zeile, und
 * ein Trigger lässt den Wechsel nur der Geschäftsführung durch. Der
 * Entzug des Spaltenrechts steht als Nacharbeit am Dateiende.
 */
revoke update, delete on app_user from authenticated, anon;

grant update (
  name, phone, location_id, weekly_hours, employment_type,
  hourly_cost, vacation_days_year, vacation_carry, active, role
) on app_user to authenticated;

/*
 * Die Schleife aus 0001 hat jedem Angemeldeten jede Zeile freigegeben.
 * Personendaten hängen seit 0008 am Bereich 'mitarbeiter' — lesend wie
 * schreibend. Eine Ausnahme für die eigene Zeile gibt es bewusst nicht:
 * es existiert kein Selfservice, der sie bräuchte (geprüft über alle
 * Aufrufe von `from("app_user")`), und mit ihr hätte jeder Monteur
 * Schreibrecht auf seinen eigenen Stundensatz.
 */
drop policy if exists app_user_upd on app_user;
drop policy if exists app_user_del on app_user;

create policy app_user_upd on app_user for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
  )
  with check (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

/*
 * Kein DELETE: ein ausgetretener Mitarbeiter wird inaktiv gesetzt, nicht
 * gelöscht — an ihm hängen Zeiten, Dokumente und Belege. Das Recht ist
 * oben ohnehin entzogen; ohne Policy sagt pg_policies dasselbe.
 */

/*
 * Bewusst ohne security definer: die Funktion liest nur den JWT und
 * braucht keine fremden Rechte. Eine definer-Funktion mehr ist eine
 * Angriffsfläche mehr.
 */
create or replace function public.app_user_rollenschutz() returns trigger
language plpgsql set search_path = public as $$
begin
  /*
   * Kein JWT mit Subject = Migration, Seed, Service-Role-Client oder
   * Cron. Die Rechteprüfung dieser Wege sitzt in der aufrufenden
   * Server Action bzw. im Skript, nicht hier.
   */
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role
     and public.current_role_name() is distinct from 'gf'::user_role then
    raise exception
      'Die Rolle darf nur die Geschäftsführung ändern.'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.app_user_rollenschutz is
  'Hält den Rollenwechsel bei der Geschäftsführung. Nötig, weil das '
  'Spaltenrecht auf app_user.role bestehen bleiben muss, solange '
  'mitarbeiterSpeichern die Spalte in jedem UPDATE mitschickt.';

drop trigger if exists app_user_rollenschutz on app_user;
create trigger app_user_rollenschutz before update of role on app_user
  for each row execute function public.app_user_rollenschutz();

comment on column app_user.role is
  'Anzeige- und Rückfallwert. Maßgeblich für RLS ist die Rolle in '
  'auth.users.raw_app_meta_data (public.current_role_name()). Änderbar '
  'nur für die Geschäftsführung — siehe Trigger app_user_rollenschutz.';


-- ====================================================== 3. ROLE_PERMISSION
/*
 * Lücke 2. Die Tabelle IST die Rechtematrix: public.can() liest sie bei
 * jeder Policy-Auswertung. Sie über die generische Schleife für jeden
 * Angemeldeten beschreibbar zu lassen, hebt jede andere Prüfung dieser
 * Datenbank auf.
 *
 * app/(app)/einstellungen/actions.ts (setPermission) prüft korrekt auf
 * Schreibrecht an 'einstellungen' — die Policy sagt jetzt dasselbe, und
 * zwar für alle Türen. Die Action arbeitet mit upsert, deshalb braucht
 * es INSERT und UPDATE.
 */
drop policy if exists role_permission_ins on role_permission;
drop policy if exists role_permission_upd on role_permission;
drop policy if exists role_permission_del on role_permission;

create policy role_permission_ins on role_permission for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.can('einstellungen', 'write')
    and public.tenant_writable()
  );

create policy role_permission_upd on role_permission for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('einstellungen', 'write')
  )
  with check (
    company_id = public.current_company_id()
    and public.can('einstellungen', 'write')
    and public.tenant_writable()
  );

create policy role_permission_del on role_permission for delete to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('einstellungen', 'write')
    and public.tenant_writable()
  );

comment on table role_permission is
  'Rollenmatrix je Mandant, ausgewertet von public.can(). Schreiben nur '
  'mit Schreibrecht auf einstellungen — wer sie ändern kann, ändert '
  'jede andere Rechteprüfung mit.';


-- =============================================================== 4. MAIL
/*
 * Lücke 5. Der Kommentar in 0044 behauptet, mail_outbox sei "für
 * authenticated gesperrt (0001)". 0001 sperrt mail_account — nicht
 * mail_outbox. Beide standen auf der generischen Schleife.
 *
 * Lesend: in mail_outbox und mail_message stehen vollständige Mailtexte,
 * also Beträge, Zahlungsfristen und Mahntexte. Damit sind die drei
 * Definer-Views v_vorgang_mail (0044), v_vorgang_wert (0030) und
 * v_vorgang_kpi (0036) umgangen, die genau diese Beträge vor Montage und
 * Lager verbergen.
 *
 * Schreibend: der Cron `mail-send` stellt jede Zeile mit status='queued'
 * zu. Ein Insert aus der Browserkonsole ist eine Mail aus dem
 * Firmenpostfach, mit der Absenderadresse des Betriebs.
 *
 * Nachgesehen, bevor das Recht fällt: der gesamte Mailpfad läuft über
 * den Service-Role-Client und ist von diesem Entzug nicht betroffen —
 * lib/vorgang/mail.ts (mailClient = createAdminClient), lib/mahnung.ts,
 * lib/material/bestellung.tsx, app/(app)/vorgaenge/versand-actions.ts,
 * lib/mail/{fetch,assign,zustellen}.ts, alle Crons über lib/cron.ts und
 * lib/export/tenant.ts. Kein einziger Zugriff mit dem RLS-Client.
 * Für die Anzeige am Vorgang bleibt v_vorgang_mail der Weg; die View ist
 * `security_invoker = off` und liest die Tabelle als Eigentümer, der
 * Entzug trifft sie also nicht.
 */
revoke all on mail_outbox    from authenticated, anon;
revoke all on mail_message   from authenticated, anon;
revoke all on mail_attachment from authenticated, anon;

comment on table mail_outbox is
  'Versandwarteschlange mit vollständigen Mailtexten. Für authenticated '
  'gesperrt (0072) — Schreiben ausschließlich über den Service-Role-Weg '
  'in lib/mail, Anzeige über v_vorgang_mail ohne Inhalte.';

comment on table mail_message is
  'Eingehende Mail mit vollständigem Text. Für authenticated gesperrt '
  '(0072): der Text enthält Beträge, die v_vorgang_wert verbirgt.';


-- ================================================= 5. LOHN UND BELEG (ZEILEN)
/*
 * Lücke 3 und 4. Dieselbe Linie wie in 0008/0010 für die Leseseite, jetzt
 * für die Schreibseite: eigene Daten darf jeder anlegen, fremde nur mit
 * dem Recht, das für den Bereich zuständig ist.
 */

-- ---------------------------------------------------------- time_entry
/*
 * Stempeln ist das Grundrecht jedes Mitarbeiters und hängt NICHT an
 * can('zeiterfassung'): die Rolle 'lager' hat dort im Standard 'none'
 * und stempelt trotzdem (app/m/heute/actions.ts, app/api/m/sync/route.ts
 * prüfen bewusst keine Rechte). Deshalb: die eigene Zeile immer, fremde
 * Zeilen nur mit Schreibrecht auf zeiterfassung — das ist genau das
 * Recht, das die Büroseite prüft (app/(app)/zeiten/actions.ts, zugang()).
 *
 * Beim UPDATE begrenzt die using-Klausel die eigene Zeile zusätzlich auf
 * die noch offenen Zustände. Gestoppt wird 'running' und 'flagged'
 * (sync/route.ts beendet auch markierte Buchungen), geschrieben wird
 * 'booked' oder 'flagged'. Eine bereits genehmigte oder ersetzte eigene
 * Zeit lässt sich damit nicht mehr anfassen.
 *
 * Offen bleibt bewusst: wer Schreibrecht auf zeiterfassung hat, kann
 * seine eigene Woche genehmigen. Das ist keine neue Lücke, sondern die
 * Folge der Standardmatrix (Monteur = zeiterfassung:write) und gehört in
 * einen eigenen Schritt — eine Policy, die Selbstgenehmigung verbietet,
 * würde die Geschäftsführung aussperren, die ihre Zeiten selbst abschliesst.
 */
drop policy if exists time_entry_ins on time_entry;
drop policy if exists time_entry_upd on time_entry;
drop policy if exists time_entry_del on time_entry;

create policy time_entry_ins on time_entry for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and (user_id = auth.uid() or public.can('zeiterfassung', 'write'))
    and public.tenant_writable()
  );

create policy time_entry_upd on time_entry for update to authenticated
  using (
    company_id = public.current_company_id()
    and (
      (user_id = auth.uid() and status in ('running', 'flagged', 'booked'))
      or public.can('zeiterfassung', 'write')
    )
  )
  with check (
    company_id = public.current_company_id()
    and (
      (user_id = auth.uid() and status in ('running', 'flagged', 'booked'))
      or public.can('zeiterfassung', 'write')
    )
    and public.tenant_writable()
  );

/*
 * Löschen: nur die eigene noch laufende Buchung (das "Verwerfen" in
 * app/m/heute/actions.ts, zeitStoppen) oder mit Schreibrecht. Eine
 * gebuchte Zeit wird korrigiert und nicht gelöscht — die alte Zeile
 * bleibt als 'replaced' stehen (CLAUDE.md 5.4).
 */
create policy time_entry_del on time_entry for delete to authenticated
  using (
    company_id = public.current_company_id()
    and (
      (user_id = auth.uid() and status = 'running')
      or public.can('zeiterfassung', 'write')
    )
    and public.tenant_writable()
  );

-- ------------------------------------------------------ time_correction
/*
 * Den Antrag stellt der Betroffene selbst, und zwar ohne jedes Recht
 * (app/m/zeiten/actions.ts, korrekturBeantragen prüft nur, dass die Zeit
 * ihm gehört). Entschieden wird im Büro über Schreibrecht auf
 * zeiterfassung (app/(app)/zeiten/actions.ts, antragEntscheiden).
 */
drop policy if exists time_correction_ins on time_correction;
drop policy if exists time_correction_upd on time_correction;
drop policy if exists time_correction_del on time_correction;

create policy time_correction_ins on time_correction for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and (user_id = auth.uid() or public.can('zeiterfassung', 'write'))
    and public.tenant_writable()
  );

create policy time_correction_upd on time_correction for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('zeiterfassung', 'write')
  )
  with check (
    company_id = public.current_company_id()
    and public.can('zeiterfassung', 'write')
    and public.tenant_writable()
  );

create policy time_correction_del on time_correction for delete to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('zeiterfassung', 'write')
    and public.tenant_writable()
  );

-- ----------------------------------------------------- time_account_move
/*
 * Die lohnrelevanteste Tabelle der Datenbank: jede Zeile verschiebt den
 * Saldo (v_time_balance addiert `minutes` ungefiltert). Ein Insert für
 * sich selbst war eine Gutschrift auf das eigene Zeitkonto.
 *
 * Geschrieben wird sie heute ausschliesslich aus Skripten über den
 * Service-Role-Client — in der Anwendung gibt es keinen Aufruf. Die
 * Policy verlangt deshalb das Recht, unter dem das Zeitkonto fachlich
 * steht: 'mitarbeiter'.
 */
drop policy if exists time_account_move_ins on time_account_move;
drop policy if exists time_account_move_upd on time_account_move;
drop policy if exists time_account_move_del on time_account_move;

create policy time_account_move_ins on time_account_move for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

create policy time_account_move_upd on time_account_move for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
  )
  with check (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

create policy time_account_move_del on time_account_move for delete to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

-- ------------------------------------------------------------- absence
/*
 * Genau die Linie, die die Server Action schon zieht
 * (app/(app)/abwesenheiten/actions.ts): für sich selbst beantragt jeder,
 * für andere braucht es Schreibrecht auf 'mitarbeiter'. Entschieden wird
 * nur mit diesem Recht (decideAbsence).
 *
 * Krankenstand gilt sofort und wird gemeldet, nicht beantragt — deshalb
 * steht er im selben Insert und braucht keine Sonderregel.
 */
drop policy if exists absence_ins on absence;
drop policy if exists absence_upd on absence;
drop policy if exists absence_del on absence;

create policy absence_ins on absence for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and (user_id = auth.uid() or public.can('mitarbeiter', 'write'))
    and public.tenant_writable()
  );

create policy absence_upd on absence for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
  )
  with check (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

create policy absence_del on absence for delete to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

-- --------------------------------------------------------- qualification
/*
 * Personalakte (0008). Eingetragen wird sie von der Personalstelle
 * (app/(app)/mitarbeiter/actions.ts, addQualification prüft
 * mitarbeiter:write) — nicht vom Betroffenen selbst, sonst wäre der
 * Nachweis einer ablaufenden Befähigung wertlos.
 */
drop policy if exists qualification_ins on qualification;
drop policy if exists qualification_upd on qualification;
drop policy if exists qualification_del on qualification;

create policy qualification_ins on qualification for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

create policy qualification_upd on qualification for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
  )
  with check (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

create policy qualification_del on qualification for delete to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('mitarbeiter', 'write')
    and public.tenant_writable()
  );

-- ---------------------------------------------------------- job_document
/*
 * Dieselbe Trennlinie wie beim Lesen in 0010: `user_id` gesetzt heisst
 * Personalakte, dann gilt Schreibrecht auf 'mitarbeiter'. Zeilen ohne
 * user_id sind Baustellen- und Kundenunterlagen und bleiben offen wie
 * bisher — für sie ist 'mitarbeiter' das falsche Recht.
 *
 * Beim UPDATE kommt die eigene Zeile dazu: die Unterschrift bestätigt
 * die betroffene Person selbst (mitarbeiter/actions.ts, markSigned
 * erlaubt ausdrücklich `dok.user_id === me.id`).
 */
drop policy if exists job_document_ins on job_document;
drop policy if exists job_document_upd on job_document;
drop policy if exists job_document_del on job_document;

create policy job_document_ins on job_document for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and (user_id is null or public.can('mitarbeiter', 'write'))
    and public.tenant_writable()
  );

create policy job_document_upd on job_document for update to authenticated
  using (
    company_id = public.current_company_id()
    and (
      user_id is null
      or user_id = auth.uid()
      or public.can('mitarbeiter', 'write')
    )
  )
  with check (
    company_id = public.current_company_id()
    and (
      user_id is null
      or user_id = auth.uid()
      or public.can('mitarbeiter', 'write')
    )
    and public.tenant_writable()
  );

create policy job_document_del on job_document for delete to authenticated
  using (
    company_id = public.current_company_id()
    and (user_id is null or public.can('mitarbeiter', 'write'))
    and public.tenant_writable()
  );

-- -------------------------------------------------------------- invoice
/*
 * Hier stand eine Haertung der Tabelle `invoice`. Die gibt es nicht
 * mehr: 0039_altbestand_entfernen.sql hat sie zusammen mit dem uebrigen
 * ersten Datenmodell geloescht (job, quote, invoice_item und so fort).
 * Das revoke scheiterte beim Einspielen entsprechend mit "relation does
 * not exist" und hat die ganze Migration zurueckgerollt.
 *
 * Der laufende Belegweg liegt in `vorgang_dokument` (0025). Die Tabelle
 * haengt bis heute allein an der generischen Policy-Schleife aus 0001,
 * prueft also nur die Firma — eine Rechnung laesst sich damit
 * nachtraeglich aendern, was CLAUDE.md 6.4 ausschliesst.
 *
 * Das gehoert geschlossen, aber nicht hier und nicht nebenbei: Kaskade,
 * Rechnungslauf und Portal schreiben alle auf diese Tabelle, und eine
 * zu enge Policy legt die Auftragsannahme still. Eigene Migration mit
 * eigenem Test.
 */

-- -------------------------------------------------------- pipeline_phase
/*
 * Phasen sind Stammdaten je Mandant (CLAUDE.md 5.1a) und werden in den
 * Einstellungen gepflegt — app/(app)/einstellungen/actions.ts prüft
 * durchgehend auf einstellungen:write. Der Grund für die Policy ist aber
 * nicht die Pflege, sondern `system_key`: an den fünf Semantiken
 * (won, lost, in_execution, ready_to_invoice, closed) hängen die
 * Automatiken. Wer sie verschiebt oder die Phase löscht, löst Rechnungen
 * aus oder schiebt Vorgänge ins Nichts.
 *
 * `pipeline` selbst bekommt dieselbe Grenze: eine Phase ohne Pipeline
 * wäre dasselbe Problem einen Schritt höher.
 */
do $$ declare t text;
begin
  foreach t in array array['pipeline', 'pipeline_phase']
  loop
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('drop policy if exists %I on %I', t || '_del', t);

    execute format(
      'create policy %I on %I for insert to authenticated
         with check (company_id = public.current_company_id()
                     and public.can(''einstellungen'', ''write'')
                     and public.tenant_writable())',
      t || '_ins', t);

    execute format(
      'create policy %I on %I for update to authenticated
         using (company_id = public.current_company_id()
                and public.can(''einstellungen'', ''write''))
         with check (company_id = public.current_company_id()
                     and public.can(''einstellungen'', ''write'')
                     and public.tenant_writable())',
      t || '_upd', t);

    execute format(
      'create policy %I on %I for delete to authenticated
         using (company_id = public.current_company_id()
                and public.can(''einstellungen'', ''write'')
                and public.tenant_writable())',
      t || '_del', t);
  end loop;
end $$;

-- ----------------------------------------------------------- doc_counter
/*
 * Nummernkreise. Gelesen werden sie in den Einstellungen, geschrieben
 * ausschliesslich von public.next_number() und public.sync_doc_counter() —
 * beide `security definer`, der Entzug trifft sie nicht. Ohne Entzug
 * konnte dagegen jeder Angemeldete den Zähler verstellen: einmal
 * zurückgedreht, und die nächste Rechnung läuft in eine schon vergebene
 * Nummer (genau der Fehler aus 0013). Lücken sind erlaubt, Duplikate
 * nicht (CLAUDE.md 5.6).
 */
revoke insert, update, delete on doc_counter from authenticated, anon;

drop policy if exists doc_counter_ins on doc_counter;
drop policy if exists doc_counter_upd on doc_counter;
drop policy if exists doc_counter_del on doc_counter;

comment on table doc_counter is
  'Nummernkreis je Mandant, Belegart und Jahr. Für authenticated nur '
  'lesbar (0072) — fortgeschrieben wird ausschliesslich über '
  'public.next_number() und public.sync_doc_counter().';


-- ===================================================== 6. BUCKET documents
/*
 * Lücke 6. Die Policies aus 0001 (Zeilen 954 und 958) entscheiden allein
 * nach dem ersten Pfadsegment. Für job-photos und quote-pdf ist das
 * richtig — das sind Unterlagen des Betriebs. Für `documents` nicht:
 * dort liegt unter {company_id}/mitarbeiter/{user_id}/… die Personalakte
 * (app/(app)/mitarbeiter/actions.ts, uploadDocument). 0010 hat die ZEILE
 * in job_document abgedichtet, die DATEI blieb offen — ein
 * `storage.from('documents').list()` plus signierte URL lieferte fremde
 * Verträge, Lohnzettel und Zertifikate.
 *
 * Aufbau wie in 0024, 0047 und 0062: Pfadsegment UND can() UND, auf der
 * Schreibseite, tenant_writable().
 *
 * Drei Pfade werden unterschieden:
 *   mitarbeiter/  → eigene Akte oder can('mitarbeiter', …)
 *   export/       → Buchhaltungsexport, Konten und Buchungssätze des
 *                   ganzen Betriebs; can('rechnungen','read')
 *   alles andere  → unverändert mandantenweit (Bestellungen, Anhänge)
 *
 * invoice-pdf kommt mit: der Bucket enthält nichts als Rechnungen, und
 * die Zeile dazu ist seit 0001 an can('rechnungen','read') gebunden.
 * Nachgesehen: keine Stelle im Code holt sich eine signierte URL auf
 * invoice-pdf oder auf documents/export — beide werden heute nur über
 * den Service-Role-Client beschrieben (Cron accounting-export,
 * lib/material/bestellung.tsx).
 */
drop policy if exists "read own company files" on storage.objects;
create policy "read own company files" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('documents', 'job-photos', 'quote-pdf', 'invoice-pdf')
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and (
      bucket_id <> 'invoice-pdf'
      or public.can('rechnungen', 'read')
    )
    and (
      bucket_id <> 'documents'
      /*
       * coalesce, weil storage.foldername() bei einer Datei direkt im
       * Mandantenordner nur ein Segment liefert — ohne das wäre der
       * Vergleich NULL und die Datei für niemanden lesbar.
       */
      or case coalesce((storage.foldername(name))[2], '')
           when 'mitarbeiter' then
             coalesce((storage.foldername(name))[3], '') = auth.uid()::text
             or public.can('mitarbeiter', 'read')
           when 'export' then
             public.can('rechnungen', 'read')
           else true
         end
    )
  );

/*
 * Die Schreibseite hatte dasselbe Loch in die andere Richtung: ohne
 * can() konnte jeder Angemeldete eine Datei in eine fremde Personalakte
 * legen. tenant_writable() fehlte ebenfalls — ein Mandant im Zustand
 * readonly konnte weiter hochladen.
 */
drop policy if exists "write own company files" on storage.objects;
create policy "write own company files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('documents', 'job-photos', 'quote-pdf')
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.tenant_writable()
    and (
      bucket_id <> 'documents'
      or (storage.foldername(name))[2] is distinct from 'mitarbeiter'
      or public.can('mitarbeiter', 'write')
    )
  );


-- ============================================= 7. LÖSCHEN BEI readonly
/*
 * Lücke 7. Die DELETE-Policies der Schleifen (0001:833, 0025:290,
 * 0034:101, 0041:151, 0043:120) prüfen nur die company_id. Bei INSERT und
 * UPDATE holt die with-check-Klausel tenant_writable() nach, bei DELETE
 * gibt es keine with-check-Klausel — also fehlte die Prüfung ganz.
 * CLAUDE.md 12.a: "Bei readonly bleibt alles lesbar und exportierbar,
 * nichts wird gelöscht." Ein Mandant in Zahlungsverzug konnte seine
 * Daten löschen, aber nichts mehr anlegen.
 *
 * Nachgezogen wird generisch über den Katalog und nicht Tabelle für
 * Tabelle: die Policies stammen aus fünf Schleifen in fünf Migrationen,
 * eine Aufzählung hier wäre beim nächsten Mal wieder unvollständig.
 * Angefasst wird nur, was tenant_writable() noch nicht nennt — die
 * Policies aus den Abschnitten oben bleiben damit unberührt.
 */
do $$
declare
  p record;
  v_anzahl int := 0;
begin
  for p in
    select pol.polname,
           cls.relname,
           pg_get_expr(pol.polqual, pol.polrelid) as using_expr
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and pol.polcmd = 'd'
      and pol.polqual is not null
      and pg_get_expr(pol.polqual, pol.polrelid) not like '%tenant_writable%'
  loop
    execute format('alter policy %I on public.%I using (%s and public.tenant_writable())',
                   p.polname, p.relname, p.using_expr);
    v_anzahl := v_anzahl + 1;
  end loop;

  raise notice '0072: % DELETE-Policies um tenant_writable() ergänzt.', v_anzahl;
end $$;

/*
 * Derselbe Mangel im Storage: 0024 und 0062 prüfen tenant_writable(),
 * 0047 nicht. Ein Logo ist kein Beleg, aber ein gekündigter Mandant soll
 * seine Marke nicht aus laufenden Angeboten löschen können.
 */
drop policy if exists "branding delete" on storage.objects;
create policy "branding delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('einstellungen', 'write')
    and public.tenant_writable()
  );


-- ====================================== 8. KRANKENSTAND OHNE FREITEXT
/*
 * Lücke 8. CLAUDE.md 12.b, wörtlich: "Krankenstand nur als
 * absence.kind = 'sick', niemals Diagnose- oder Freitextfelder für
 * Krankheitsgründe. Kein Feld dafür bauen, auch nicht optional."
 *
 * Die Oberfläche hält sich daran (das Notizfeld wird bei Krankenstand
 * nicht angeboten, requestAbsence setzt note explizit auf null). Die
 * Datenbank hielt sich an nichts — und die INSERT-Policy war generisch,
 * ein direkter Insert mit Notiz also möglich. Ein Gesundheitsdatum nach
 * Art. 9 DSGVO gehört nicht an eine Stelle, die nur die Oberfläche
 * freihält.
 *
 * Die Notiz bleibt für alle anderen Arten erhalten: bei Urlaub und
 * Zeitausgleich ist sie ein organisatorischer Hinweis ("Übergabe an
 * Zauner") und genau dafür gedacht.
 *
 * Altbestand wird vorher bereinigt, sonst scheitert der Constraint. Der
 * Audit-Trigger wird dafür abgeschaltet: er würde den Text, den wir
 * gerade entfernen, als old_data in ein append-only Log schreiben, aus
 * dem niemand ihn wieder herausbekommt. Genau das soll nicht passieren.
 */
do $$
declare v_betroffen int;
begin
  select count(*) into v_betroffen from absence where kind = 'sick' and note is not null;

  if v_betroffen > 0 then
    alter table absence disable trigger absence_audit;
    update absence set note = null where kind = 'sick' and note is not null;
    alter table absence enable trigger absence_audit;

    raise notice '0072: % Krankenstandsnotizen entfernt (ohne Audit-Eintrag, '
                 'der Text soll nicht ins Log wandern).', v_betroffen;
  else
    raise notice '0072: keine Krankenstandsnotizen im Bestand.';
  end if;
end $$;

alter table absence
  add constraint absence_sick_ohne_notiz
  check (kind <> 'sick' or note is null);

comment on column absence.note is
  'Organisatorischer Hinweis, etwa zur Vertretung. Bei kind = ''sick'' '
  'erzwingt absence_sick_ohne_notiz null: ein Krankheitsgrund ist ein '
  'Gesundheitsdatum nach Art. 9 DSGVO und hat hier kein Feld '
  '(CLAUDE.md 12.b).';


-- =====================================================================
-- NACHARBEIT — bewusst nicht scharf geschaltet
--
-- Die folgenden drei Blöcke gehören fachlich hierher, würden aber
-- entweder laufenden Code brechen oder eine Entscheidung treffen, die
-- nicht in einer Migration getroffen werden sollte. Sie stehen hier
-- fertig, damit der nächste Schritt nicht wieder bei der Recherche
-- anfängt.
-- =====================================================================

/*
 * A) Spaltenrecht auf app_user.role ganz entziehen.
 *
 * Voraussetzung: app/(app)/mitarbeiter/actions.ts (mitarbeiterSpeichern)
 * schickt `role` nur noch mit, wenn sie sich wirklich ändert — oder
 * setzt sie über eine eigene, `security definer`-Funktion. Postgres
 * prüft Spaltenrechte gegen die SET-Liste, nicht gegen die Werte:
 * solange die Spalte in jedem UPDATE mitläuft, sperrt der Entzug nicht
 * den Rollenwechsel, sondern jedes Speichern eines Mitarbeiters.
 *
 * Danach ist der Trigger app_user_rollenschutz entbehrlich, und der
 * Rückfall in lib/session.ts kann ebenfalls weg.
 *
 *   revoke update (role) on app_user from authenticated;
 */

/*
 * B) Altbestand im audit_log.
 *
 * Abschnitt 8 entfernt die Krankenstandsnotizen aus `absence`, ohne
 * einen Audit-Eintrag zu erzeugen. Was vor dieser Migration schon einmal
 * geändert wurde, steht aber im Log — audit_log.old_data/new_data
 * enthalten die vollständige Zeile samt note.
 *
 * Nicht ausgeführt, weil es zwei Grundsätze gegeneinander stellt:
 * audit_log ist append-only (CLAUDE.md 5.5), und Art.-9-Daten gehören
 * nicht in ein unbefristetes Log (12.b). Die Entscheidung gehört in das
 * Löschkonzept, nicht in eine Migration — und sie ist nur nötig, wenn
 * die Abfrage unten überhaupt Zeilen liefert.
 *
 *   select count(*) from audit_log
 *   where table_name = 'absence'
 *     and coalesce(new_data ->> 'kind', old_data ->> 'kind') = 'sick'
 *     and (new_data ->> 'note' is not null or old_data ->> 'note' is not null);
 *
 * Wenn ja, redigieren statt löschen — der Eintrag bleibt, der Text geht:
 *
 *   update audit_log
 *      set old_data = old_data - 'note',
 *          new_data = new_data - 'note'
 *    where table_name = 'absence'
 *      and coalesce(new_data ->> 'kind', old_data ->> 'kind') = 'sick';
 */

/*
 * C) Selbstgenehmigung von Zeiten.
 *
 * `wocheGenehmigen` hängt an can('zeiterfassung','write'), und dieses
 * Recht hat in der Standardmatrix auch der Monteur — er kann seine
 * eigenen Zeiten also auf 'approved' setzen und damit in den Saldo
 * bringen, ohne dass jemand hingesehen hat.
 *
 * Nicht geschlossen, weil die naheliegende Policy
 *
 *   ... and (user_id <> auth.uid() or public.can('mitarbeiter','write'))
 *
 * die Geschäftsführung aussperren würde, die ihre Woche selbst
 * abschliesst, und die Bauleitung (mitarbeiter:read) ebenfalls. Die
 * Grenze gehört in die Rollenmatrix: Genehmigen ist kein Recht an
 * 'zeiterfassung', sondern eines an 'mitarbeiter'. Das ist eine
 * fachliche Änderung mit Wirkung auf den Alltag jedes Mandanten und
 * braucht einen eigenen Schritt samt Anpassung der Server Action.
 */
