-- Der Mandant darf seine eigenen Firmendaten pflegen.
--
-- company hatte bisher nur eine SELECT-Policy. Jedes UPDATE aus der App
-- lief damit an der Policy vorbei und traf null Zeilen — ohne Fehler.
-- Aufgefallen ist es beim Speichern der Zeiterfassungsregeln: die
-- Oberfläche meldete Erfolg, in der Datenbank stand der alte Wert.
--
-- Zwei Sicherungen, weil eine hier nicht reicht:
--
--   1. Die Policy begrenzt auf die eigene Firma und verlangt Schreibrecht
--      auf "einstellungen". Ein Monteur ändert keine Bankverbindung.
--
--   2. Spaltengenaue Rechte begrenzen, WAS geändert werden darf. Eine
--      Row-Level-Policy kann das nicht: sie entscheidet über Zeilen, nicht
--      über Spalten. Ohne Punkt 2 könnte ein Mandant seinen eigenen Tarif,
--      seine Sitzplätze, sein Speicherkontingent und seinen Status setzen —
--      also die Abrechnung selbst schreiben.
--
-- Nach der Lektion aus 0009: erst das Tabellenrecht entziehen, dann die
-- unbedenklichen Spalten einzeln gewähren. Eine neue Spalte auf company
-- ist damit zunächst für niemanden schreibbar. Das ist die richtige
-- Voreinstellung — Abrechnungsfelder sollen nicht versehentlich mitwandern.

revoke update on company from authenticated;

grant update (
  name, uid_nr,
  address, zip, city, country,
  iban, bic,
  pdf_settings, accounting_settings,
  time_settings
) on company to authenticated;

drop policy if exists company_update on company;
create policy company_update on company
  for update to authenticated
  using (
    id = public.current_company_id()
    and public.can('einstellungen', 'write')
  )
  with check (
    id = public.current_company_id()
    and public.tenant_writable()
  );

comment on table company is
  'Mandantenstamm. Schreibrecht nur auf Stammdaten und Einstellungen — '
  'status, plan, seats, storage_quota_mb, feature_flags und '
  'stripe_customer_id gehören dem Betreiber und sind für authenticated '
  'nicht schreibbar (Spaltenrechte in 0023).';
