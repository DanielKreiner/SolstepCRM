/*
 * Belege werden nicht mehr still geändert.
 *
 * CLAUDE.md 6.4 verlangt: „Rechnungs-PDF nach Erzeugung unveränderlich;
 * Korrektur nur über Storno + Neuausstellung." Für die DATEI galt das
 * (0001 gibt dem Bucket `invoice-pdf` kein Schreibrecht), für die ZEILE
 * nicht. `vorgang_dokument` hing bis hierher allein an der generischen
 * Policy-Schleife aus 0001 und prüfte nur die Firma. Jeder angemeldete
 * Mitarbeiter konnte damit `update vorgang_dokument set betrag_brutto =
 * 1` auf eine versendete Rechnung absetzen — über den anon-Client aus
 * der Browserkonsole, ohne Spur im Belegweg und ohne dass die Nummer
 * sich ändert.
 *
 * Dass es dieselbe Tabelle nicht schon früher getroffen hat, liegt
 * daran, dass 0072 die alte Tabelle `invoice` härten wollte — die gibt
 * es seit 0039 nicht mehr. Der laufende Belegweg liegt hier.
 *
 * Zwei Werkzeuge, und die Reihenfolge ist wichtig:
 *
 * 1. SPALTENRECHTE für das, was unveränderlich sein muss. Eine Policy
 *    kann das nicht: sie entscheidet über die ganze Zeile, und die Zeile
 *    MUSS änderbar bleiben — eine Zahlung wird vermerkt, eine Mahnstufe
 *    steigt, ein Storno wird eingetragen. Nur Betrag, Nummer, Art und
 *    Fassung dürfen nach dem Anlegen nie wieder wandern. Dieselbe
 *    Lehre wie bei `app_user.hourly_cost` (0009) und
 *    `vorgang.rabatt_prozent` (0041).
 *
 * 2. POLICIES für die Frage, WER überhaupt schreiben darf.
 */

-- ------------------------------------------------------ SPALTENRECHTE
/*
 * Erst das Tabellenrecht entziehen, dann die unbedenklichen Spalten
 * einzeln gewähren — ein Tabellen-GRANT deckt sonst alle Spalten ab,
 * auch die, die später dazukommen (Lektion aus 0009).
 *
 * Was nach dem Anlegen noch wandern darf:
 *   status, bezahlt_am, bezahlt_betrag  — die Zahlung
 *   storniert_am, storno_grund          — der Storno (0073)
 *   mahnung_aktiv                       — Mahnung aussetzen
 *   mahnstufe, gemahnt_am               — der Mahnlauf
 *
 * Was nicht mehr wandern darf, und genau darum geht es:
 *   betrag_netto, betrag_brutto, nummer, typ, version, storage_path,
 *   dateiname, vorgang_id, company_id, faellig_am, kunde_sichtbar
 *
 * `faellig_am` steht bewusst in der zweiten Liste: ein stillschweigend
 * verschobenes Zahlungsziel ist dasselbe Problem wie ein geänderter
 * Betrag, nur langsamer.
 */
revoke update on vorgang_dokument from authenticated, anon;

grant update (
  status,
  bezahlt_am,
  bezahlt_betrag,
  storniert_am,
  storno_grund,
  mahnung_aktiv,
  mahnstufe,
  gemahnt_am
) on vorgang_dokument to authenticated;

comment on column vorgang_dokument.betrag_brutto is
  'Kein UPDATE-Spaltenrecht für authenticated (0074). Ein ausgestellter '
  'Beleg ändert seinen Betrag nicht; Korrektur läuft über Storno und '
  'Neuausstellung.';

-- ------------------------------------------------------------ POLICIES
drop policy if exists vorgang_dokument_ins on vorgang_dokument;
drop policy if exists vorgang_dokument_upd on vorgang_dokument;
drop policy if exists vorgang_dokument_del on vorgang_dokument;

/*
 * Anlegen: wer Angebote ODER Rechnungen schreiben darf.
 *
 * Nicht enger, und das ist eine bewusste Entscheidung. Die
 * Annahme-Kaskade legt in EINEM Durchgang die Auftragsbestätigung und
 * die Anzahlungsrechnung an, geprüft wird beim Auslösen aber nur
 * `pipelines:write` und `angebote:write` (kaskade-actions.ts). In der
 * Standardmatrix hat jeder, der annehmen darf, auch `rechnungen:write`
 * — ein Mandant kann das aber anders einstellen, und dann stünde die
 * Auftragsannahme mit „Rechnung konnte nicht erzeugt werden". Genau so
 * ein Fehler ist heute schon einmal entstanden, weil eine Verschärfung
 * einen Pfad nicht kannte.
 *
 * Was die Policy sicher ausschliesst, ist der eigentliche Punkt:
 * Montage und Lager haben weder das eine noch das andere Recht.
 */
create policy vorgang_dokument_ins on vorgang_dokument
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and (public.can('angebote', 'write') or public.can('rechnungen', 'write'))
  );

/*
 * Ändern: nur mit Schreibrecht auf Rechnungen.
 *
 * Alles, was nach den Spaltenrechten oben überhaupt noch änderbar ist,
 * gehört zum Geldweg — Zahlung, Storno, Mahnung. Die Angebotsseite legt
 * Fassungen an und löscht sie im Fehlerfall, sie ändert keine.
 */
create policy vorgang_dokument_upd on vorgang_dokument
  for update to authenticated
  using (
    company_id = public.current_company_id()
    and public.can('rechnungen', 'write')
  )
  with check (
    company_id = public.current_company_id()
    and public.tenant_writable()
  );

/*
 * Löschen: nur Entwürfe.
 *
 * Ein versendeter Beleg verschwindet nicht, er wird storniert — sonst
 * fehlt er in der Aufbewahrung und seine Nummer hat keine Spur. Der
 * einzige Löschpfad in der Anwendung verwirft einen Rechnungsentwurf
 * („Der Entwurf war nicht versendet. Die Nummer verfällt."), und der
 * Rückbau einer missglückten Angebotsfassung läuft über den
 * Service-Role-Client und ist von dieser Policy ohnehin nicht betroffen.
 */
create policy vorgang_dokument_del on vorgang_dokument
  for delete to authenticated
  using (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and status = 'entwurf'
    and (public.can('angebote', 'write') or public.can('rechnungen', 'write'))
  );

comment on table vorgang_dokument is
  'Angebote, Auftragsbestätigungen und Rechnungen. Revisionssicher: '
  'Betrag, Nummer, Art und Fassung haben für authenticated kein '
  'UPDATE-Spaltenrecht (0074), gelöscht werden dürfen nur Entwürfe.';
