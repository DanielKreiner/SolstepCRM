-- =====================================================================
-- 0073 — Storno und Teilzahlung am Rechnungsbeleg
--
-- Zwei Lücken im Belegweg aus 0025, beide in derselben Tabelle.
--
-- 1. STORNO. `status = 'storniert'` steht seit 0025 im CHECK, wird in
--    der Postenliste, im Umsatzbericht, im Buchhaltungsexport und im
--    Mahnlauf ausgefiltert — aber kein Codepfad hat den Status je
--    gesetzt. Eine falsch erzeugte Rechnung war damit nicht
--    korrigierbar, obwohl CLAUDE.md 6.4 "Korrektur nur über Storno +
--    Neuausstellung" verlangt. Es fehlten nicht die Semantik, sondern
--    der Grund und der Zeitpunkt: ein Storno ohne beides ist nicht
--    nachvollziehbar, und der Ereignisstrom allein trägt es nicht —
--    `vorgang_event` ist löschbar (Begründung in 0025), die Rechnung
--    muss die Tatsache selbst tragen.
--
-- 2. TEILZAHLUNG. Es gab keine Spalte für einen bezahlten Teilbetrag.
--    Die Zahlungserfassung schrieb den Teilbetrag in den Ereignistext
--    und liess den Beleg auf 'versendet' stehen. Folge an einem echten
--    Fall: Schlussrechnung 12.427,20 brutto, der Kunde zahlt 10.000 —
--    "Offen gesamt" zeigte weiter 12.427,20, und die Zahlungserinnerung
--    forderte ebenfalls den vollen Betrag. Der Betrieb hat einem
--    zahlenden Kunden den Gesamtbetrag nachgemahnt.
--
-- Bewusst KEINE Stornorechnung als eigener Beleg mit negativem Betrag:
-- die Begründung steht in `lib/vorgang/zahlung.ts` und in
-- `app/(app)/vorgaenge/rechnung-actions.ts` bei `rechnungStornieren`.
-- Deshalb bleibt der CHECK auf `typ` unverändert — kein neuer Wert.
-- =====================================================================

alter table vorgang_dokument
  add column if not exists bezahlt_betrag numeric(12,2) not null default 0,
  add column if not exists storniert_am timestamptz,
  add column if not exists storno_grund text;

comment on column vorgang_dokument.bezahlt_betrag is
  'Summe der erfassten Zahlungen, brutto. Der offene Posten ist '
  'betrag_brutto - bezahlt_betrag; status wechselt erst auf ''bezahlt'', '
  'wenn nichts mehr offen ist.';

comment on column vorgang_dokument.storniert_am is
  'Zeitpunkt des Storno. Die Zeile bleibt stehen — Rechnungen sind '
  'aufzubewahren, gelöscht wird hier nichts.';

comment on column vorgang_dokument.storno_grund is
  'Warum storniert wurde. Pflicht in der Action; ein Storno ohne Grund '
  'ist für die Buchhaltung nicht nachvollziehbar.';

/*
 * numeric(12,2) und not null default 0 — nicht nullable.
 *
 * Nullable hiesse, dass "nichts bezahlt" und "unbekannt" dieselbe
 * Darstellung bekommen, und jede Rechnung des Restbetrags müsste
 * `coalesce` mitschleppen. Ein Beleg hat immer einen bezahlten Betrag,
 * er ist am Anfang eben null Euro. Geld durchgehend numeric(12,2),
 * niemals float (CLAUDE.md 5.2).
 */
alter table vorgang_dokument
  drop constraint if exists vorgang_dokument_bezahlt_betrag_nicht_negativ;

alter table vorgang_dokument
  add constraint vorgang_dokument_bezahlt_betrag_nicht_negativ
  check (bezahlt_betrag >= 0);

/*
 * Keine Obergrenze gegen betrag_brutto in der Datenbank: Belege ohne
 * Betrag (Materialliste, Protokoll) haben betrag_brutto null, und eine
 * Überzahlung wäre damit ein Constraint-Fehler statt einer Meldung an
 * den Benutzer. Die Grenze zieht `zahlungBuchen()` in
 * lib/vorgang/zahlung.ts, mit Begründung und mit Test.
 */

-- ------------------------------------------------------- SPALTENRECHT
/*
 * Neue Spalten brauchen ein Leserecht, sobald eine Tabelle spaltenweise
 * gewährt ist — und eine Spalte ohne Recht lässt nicht die Spalte,
 * sondern die GANZE Abfrage leer laufen. Genau daran ist die
 * Auftragsannahme schon einmal gescheitert (0009, 0029, 0041, 0050).
 *
 * `vorgang_dokument` hängt heute an Tabellenrechten; 0050 hat
 * `grant select (version)` zusätzlich gesetzt. Spaltenrechte sind
 * additiv, ein Tabellenrecht wird davon nicht entzogen — die drei
 * Spalten sind also schon lesbar. Sie werden hier trotzdem ausdrücklich
 * gewährt, weil 0074 die Schreibseite dieser Tabelle härtet: wenn dort
 * das Tabellenrecht fällt und spaltenweise neu gesetzt wird, steht das
 * Recht für diese drei Spalten bereits.
 */
grant select (bezahlt_betrag, storniert_am, storno_grund)
  on vorgang_dokument to authenticated;
grant update (bezahlt_betrag, storniert_am, storno_grund)
  on vorgang_dokument to authenticated;

-- --------------------------------------------------------- ALTBESTAND
/*
 * Was bisher als bezahlt vermerkt ist, ist vollständig bezahlt — anders
 * war es nicht erfassbar. Ohne diesen Nachtrag stünde jede alte
 * Rechnung mit bezahlt_betrag 0 da, und der Umsatzbericht wiese "davon
 * bezahlt" mit null aus, obwohl das Geld da ist.
 */
update vorgang_dokument
   set bezahlt_betrag = betrag_brutto
 where status = 'bezahlt'
   and betrag_brutto is not null
   and bezahlt_betrag = 0;

/*
 * Bestehende stornierte Belege bekommen einen Zeitpunkt, damit die
 * Anzeige nicht zwischen "storniert" und "storniert, aber ohne Datum"
 * unterscheiden muss. Einen Grund können sie nicht bekommen — den hat
 * niemand erfasst, und erfunden wird er nicht.
 */
update vorgang_dokument
   set storniert_am = coalesce(storniert_am, created_at)
 where status = 'storniert';

-- -------------------------------------------------------------- INDEX
/*
 * Die Postenliste und der Mahnlauf fragen nach offenen Rechnungen eines
 * Mandanten. Der Index aus 0040 deckt (company_id, status, faellig_am)
 * ab; der Restbetrag wird aus zwei Spalten gerechnet und ist nicht
 * indizierbar, ohne ihn zu materialisieren. Dafür ist die Menge zu
 * klein — ein Betrieb hat offene Posten in Dutzenden, nicht in
 * Hunderttausenden. Kein weiterer Index.
 */
