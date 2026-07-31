# Stand der Umsetzung

Stand 31.07.2026. Reihenfolge und Definition of Done aus `CLAUDE.md` Abschnitt 12.

**100 E2E-Tests, 83 Unit-Tests.** `pnpm typecheck`, `pnpm lint` und `pnpm build`
laufen sauber durch. Der Seed-Zustand ist nach der kompletten Testsuite
unverändert — die Tests hinterlassen keine Drift.

## Design nach den Vorlagen in `export/`

Die drei gerenderten Vorlagen sind die verbindliche Referenz. Farben und
Typografie stimmten von Anfang an; gefehlt haben die Bauteile, die daraus
ein Werkzeug machen. Nachgezogen:

- `KpiKarte` (Akzentvariante, Pille, Klartextzeile) auf allen 15 Screens
  statt der kleinen `Stat`-Kacheln
- `Balkenchart`, `Ring`, `Avatar`, `Abschnitt`, `LaufendeZeit`,
  `Fortschrittsleiste`
- Cockpit vollständig nach SPEC 4.1
- Einstellungen mit Unternavigation, neu darin Standorte mit
  Arbeitszeitregeln und die Nummernkreise aus `doc_counter`
- Pipelinekarte mit Stundenfortschritt, Deckungsbeitrag-Ampel und
  Anlagengröße (Migration 0011)
- Monteur-App: Bottom-Nav mit fünf Punkten und hervorgehobenem Stempeln,
  neue Screens Auftragsliste und Profil
- Kundenportal: Fortschrittsleiste, Anlagendaten, Terminbestätigung

## Fertig und getestet

| # | Meilenstein | Definition of Done | Tests |
|---|---|---|---|
| 0 | Fundament | RLS-Isolationstest mit zwei Mandanten grün, Seed läuft, Login funktioniert | 10 |
| 1 | Auftrag, Kunde, Artikel, Zeit, Material | Zeitbuchung erzeugt korrekten Saldo, Materialentnahme senkt Bestand | 6 |
| 2 | Pipelines Board/Tabelle/Timeline | Drag ändert Phase serverseitig, Filter in der URL, Ringkennzahlen stimmen | 6 |
| 3 | Angebote, Import, PDF, Annahme | Annahme legt Auftrag an und erzeugt Aufgabe „Termin fixieren" | 8 |
| 4 | Lager, Bestellungen, Bestellvorschlag | Vorschlag aus Bedarf und Mindestbestand, Mailversand an Lieferant | 5 |
| 5 | Monteur-PWA, Offline-Queue | Flugmodus: 3 Buchungen offline, nach Reconnect vollständig | 6 |
| 6 | Einsatzplanung, Konfliktprüfung | Ruhezeitverletzung blockt Veröffentlichung bis zur Bestätigung | 6 + 17 Unit |
| 7 | Rechnungen, Mahnlauf | Teilrechnungslogik, Mahnstufen automatisch | 6 + 18 Unit |
| 8 | Kundenportal | Magic Link, Annahme mit Name/IP/Zeit, Ticket-Erzeugung | 6 |
| 9 | CRM-Pipelines, Service-Tickets | Aktivitäten laufen automatisch ein | 7 |
| 10 | Personal | Jahresplaner, Resturlaub, Korrekturworkflow, E-Signatur-Status | 13 + 11 Unit |
| 11 | Chat, Bewerber, Berichte, Einstellungen | Rollenmatrix serverseitig, Phasen editierbar, Export nach Excel/PDF | 17 |

Dazu quer über alle Meilensteine:

- **9 Cron-Endpunkte**, alle mit Geheimnisprüfung und Idempotenz — 7 Tests
- **Mandantenexport als ZIP** (CLAUDE.md 12.a „Exit") — 6 Tests
- **Rollenrechte innerhalb des Mandanten** — 10 Unit-Tests

## Offen

**Meilenstein 12 — SaaS-Betrieb.** Das Betreiber-Backoffice `/ops` mit eigener
Auth und MFA, Provisioning neuer Mandanten, CSV-Import für den Altbestand,
Stripe-Anbindung, Usage-Meldung und die dokumentierte Restore-Übung.

Vorhanden sind bereits: der Selfservice-Export, `company.status` steuert über
`tenant_writable()` in der Policy die Schreibrechte, `usage_snapshot` wird vom
Monatslauf gefüllt, `support_session` und `job_run` existieren, und
`/api/health` beantwortet den Uptime-Monitor.

**Kleinere Lücken**

- Der Löschlauf für Bewerberdaten nach sechs Monaten ist nicht automatisiert
- Feiertage im Jahresplaner: gezählt werden Werktage Montag bis Freitag,
  `location.holiday_region` wird noch nicht ausgewertet
- Der Mailabruf ist gebaut, aber nie gegen ein echtes Postfach gelaufen —
  ohne verbundenes Konto ruht der Job

## Was vor dem ersten echten Mandanten fehlt

- Produktname und Domain. `BRAND` läuft mit Platzhalter „Betrieb"
- **Staging-Supabase-Projekt.** Die CI setzt beim Isolationstest Mandanten
  und Nutzer neu — läuft das gegen die Produktivdatenbank, löscht der erste
  grüne Testlauf die Arbeitszeiten eines Kunden. Solange die Secrets fehlen,
  bricht der Job bewusst ab, statt grün zu melden
- Systempostfach, Microsoft-Entra-App, Stripe
- AVV, TOM, Löschkonzept, Verzeichnis von Verarbeitungstätigkeiten

## Abweichungen von CLAUDE.md, bewusst und begründet

1. **Node 22 statt 20.** `supabase-js` braucht natives WebSocket. `.nvmrc` liegt
   im Repo.
2. **Schriften über `next/font/google` statt `next/font/local`.** Next lädt sie
   zur Buildzeit und liefert sie vom eigenen Host — kein Request des Nutzers an
   Google. Sobald die woff2 im Repo liegen, ist die Umstellung ein Einzeiler.
3. **`quote` und `service_ticket` haben `phase_id` bekommen** (0006). CLAUDE.md
   5.1a verlangt Phasen als Mandanten-Stammdaten, das Ausgangsschema hatte dort
   Enums.
4. **Die ESLint-Sperre gegen den Service-Role-Client ist für drei Pfade
   geöffnet**, jeweils kommentiert: `lib/portal/**` (keine Session, an der RLS
   greifen könnte), `lib/cron.ts` (läuft über alle Mandanten) und
   `lib/export/**` (muss vollständig sein, die Sicherung sitzt in der Route).
5. **Kein lokales Supabase.** Auf der Maschine ist kein Docker installiert;
   Migrationen und Seed laufen gegen das verknüpfte Projekt.

## Fehler, die unterwegs gefunden und behoben wurden

Im Ausgangsschema:

- `0001_init.sql` ließ sich nicht anwenden: `tenant_writable()` stand vor
  `current_company_id()`
- **Alle Views umgingen die Mandantentrennung** (0003). Postgres wertet die RLS
  der Basistabellen bei Views standardmäßig nicht aus. `search_index` speist die
  Command-Palette — jeder Monteur hätte über ⌘K die Daten aller anderen Betriebe
  durchsuchen können
- `v_job_kpi` rechnete Materialrückgaben nicht gegen (0004)
- `stock_move` war lösch- und änderbar, und das Löschen drehte den Bestand nicht
  zurück (0005)

Im eigenen Code:

- **Der Monteur sah die Zeiten seiner Kollegen** (0008). Die Policy hing an
  `can('zeiterfassung')` — genau der Berechtigung, die er zum eigenen Stempeln
  braucht
- **Stundensätze waren für jeden lesbar** (0008/0009). Der erste Versuch griff
  nicht: `REVOKE SELECT (spalte)` entfernt nichts, solange ein Tabellenrecht
  besteht
- **Die Personalakte war für alle offen** (0010) — jeder konnte den Lohnzettel
  jedes Kollegen lesen
- Acht der neun in `vercel.json` angekündigten Cron-Endpunkte existierten nicht
  und wären auf Vercel ins 404 gelaufen
- Die Genehmigung einer Zeitkorrektur wurde gesetzt, bevor der Ersatzeintrag
  geschrieben war — scheiterte der, stand „genehmigt" ohne Wirkung
- Eine `"use server"`-Datei exportierte eine Konstante. Der Build meldet das
  nicht, die Seite stürzt zur Laufzeit ab

## Befehle

```bash
pnpm dev              # Entwicklung auf :3000
pnpm seed:db          # Schema und Grunddaten
pnpm seed:demo        # Nutzer, Bewegungen, Demodaten, Portalzugang
pnpm test             # Unit- und Rechtetests
pnpm exec playwright test   # E2E gegen eigenen Server auf :3100
```

Demo-Zugänge: `gf@`, `buero@`, `bauleitung@`, `monteur@`, `lager@` jeweils
`hofstaetter.example.com`, plus `gf@zweitbetrieb.example.com` als Fremdmandant
für den Isolationstest. Passwort aus `SEED_PASSWORD`.
