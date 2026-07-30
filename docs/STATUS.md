# Stand der Umsetzung

Stand 30.07.2026. Reihenfolge und Definition of Done aus `CLAUDE.md` Abschnitt 12.

## Fertig und getestet

| # | Meilenstein | Definition of Done | Nachweis |
|---|---|---|---|
| 0 | Fundament | RLS-Isolationstest mit zwei Mandanten grün, Seed läuft, Login funktioniert | `tests/isolation.spec.ts`, 10 Tests |
| 1 | Auftrag, Kunde, Artikel, Zeit, Material | Zeitbuchung erzeugt korrekten Saldo, Materialentnahme senkt Bestand | `e2e/meilenstein-1.spec.ts`, 6 Tests |
| 2 | Pipelines Board/Tabelle/Timeline | Drag ändert Phase serverseitig, Filter in der URL, Ringkennzahlen stimmen | `e2e/meilenstein-2.spec.ts`, 6 Tests |
| 3 | Angebote, Import, PDF, Annahme | Annahme legt Auftrag an und erzeugt Aufgabe „Termin fixieren" | `e2e/meilenstein-3.spec.ts`, 8 Tests |
| 4 | Lager, Bestellungen, Bestellvorschlag | Vorschlag aus Bedarf und Mindestbestand, Mailversand an Lieferant | `e2e/meilenstein-4.spec.ts`, 5 Tests |
| 5 | Monteur-PWA, Offline-Queue | Flugmodus: 3 Buchungen offline, nach Reconnect vollständig | `e2e/meilenstein-5.spec.ts`, 6 Tests |
| 6 | Einsatzplanung, Konfliktprüfung | Ruhezeitverletzung blockt Veröffentlichung bis zur Bestätigung | `e2e/meilenstein-6.spec.ts` 6 + `lib/rules/worktime.spec.ts` 17 |
| 7 | Rechnungen, Mahnlauf | Teilrechnungslogik, Mahnstufen automatisch | `e2e/meilenstein-7.spec.ts` 6 + `lib/money.spec.ts` 18 |
| 8 | Kundenportal | Magic Link, Annahme mit Name/IP/Zeit, Ticket-Erzeugung | `e2e/meilenstein-8.spec.ts`, 6 Tests |
| 9 | CRM-Pipelines, Service-Tickets | Aktivitäten laufen automatisch ein | `e2e/meilenstein-9.spec.ts`, 7 Tests |

62 E2E-Tests, 56 Unit-Tests. `pnpm typecheck`, `pnpm lint` und `pnpm build` laufen sauber durch.

## Teilweise fertig

**Meilenstein 10 — Personal.** Jahresplaner, Resturlaub und der
Korrekturworkflow stehen und sind getestet (`e2e/meilenstein-10.spec.ts`,
6 Tests, plus `lib/absence.spec.ts`, 11 Tests).

Offen: Mitarbeiterdokumente mit E-Signatur-Status, Mitarbeiter-Detailseite,
Mitarbeiter-Desktop unter `/(me)`.

## Offen

**Meilenstein 11 — Chat, Bewerber, Berichte, Einstellungen.**
Für alle vier stehen benannte Platzhalter in der Navigation. Die
Rollenmatrix wirkt bereits serverseitig über `role_permission` und `can()`,
sie ist nur noch nicht im UI pflegbar. Ebenso die Phasen je Mandant: die
Tabellen `pipeline` und `pipeline_phase` sind fertig, es fehlt die
Bearbeitungsoberfläche.

**Meilenstein 12 — SaaS-Betrieb.**
`/ops`, Provisioning, CSV-Import, Stripe, Usage-Meldung, Export-ZIP und die
dokumentierte Restore-Übung fehlen vollständig. Die Grundlagen liegen: die
Tabellen `support_session`, `usage_snapshot` und `job_run` existieren,
`company.status` steuert über `tenant_writable()` bereits in der Policy die
Schreibrechte, und `/api/health` beantwortet den Uptime-Monitor.

## Was vor dem ersten echten Mandanten fehlt

Aus `CLAUDE.md` Abschnitt 14, unverändert offen:

- Produktname und Domain. `BRAND` läuft mit Platzhalter „Betrieb"
- Eigenes GitHub-Repo. Es gibt bisher nur lokale Commits
- **Staging-Supabase-Projekt.** Die CI ist darauf ausgelegt, der
  RLS-Isolationstest kann ohne Staging nicht laufen. Solange die Secrets
  fehlen, bricht der Job bewusst ab, statt grün zu melden
- Systempostfach, Microsoft-Entra-App, Stripe
- AVV, TOM, Löschkonzept, Verzeichnis von Verarbeitungstätigkeiten

## Abweichungen von CLAUDE.md, bewusst und begründet

1. **Node 22 statt 20.** `supabase-js` braucht natives WebSocket. `.nvmrc`
   liegt im Repo.
2. **Schriften über `next/font/google` statt `next/font/local`.** Next lädt
   sie zur Buildzeit und liefert sie vom eigenen Host — kein Request des
   Nutzers an Google. Sobald die woff2-Dateien im Repo liegen, ist die
   Umstellung ein Einzeiler.
3. **`quote` und `service_ticket` haben `phase_id` bekommen** (Migration
   0006). CLAUDE.md 5.1a verlangt Phasen als Mandanten-Stammdaten, das
   Ausgangsschema hatte dort Enums.
4. **Die ESLint-Sperre gegen den Service-Role-Client ist für `lib/portal/**`
   geöffnet.** Das Portal hat keine Supabase-Session; die Mandantentrennung
   dieses Pfades liegt vollständig in `lib/portal/data.ts`.
5. **Kein lokales Supabase.** Auf der Maschine ist kein Docker installiert;
   Migrationen und Seed laufen gegen das verknüpfte Projekt.

## Fehler im Ausgangsmaterial, die behoben wurden

- `0001_init.sql` ließ sich nicht anwenden: `tenant_writable()` stand vor
  `current_company_id()`.
- **Alle Views umgingen die Mandantentrennung** (Migration 0003). Postgres
  wertet die RLS der Basistabellen bei Views standardmäßig nicht aus.
  `search_index` speist die Command-Palette — jeder Monteur hätte über ⌘K
  die Daten aller anderen Betriebe durchsuchen können.
- `v_job_kpi` rechnete Materialrückgaben nicht gegen (0004).
- `stock_move` war für `authenticated` lösch- und änderbar, und das Löschen
  drehte den Bestand nicht zurück (0005).

## Befehle

```bash
pnpm dev              # Entwicklung auf :3000
pnpm seed:db          # Schema und Grunddaten
pnpm seed:demo        # Nutzer, Bewegungen, Demodaten, Portalzugang
pnpm test             # Unit-Tests
pnpm exec playwright test   # E2E gegen eigenen Server auf :3100
```

Demo-Zugänge: `gf@`, `buero@`, `bauleitung@`, `monteur@`, `lager@` jeweils
`hofstaetter.example.com`, plus `gf@zweitbetrieb.example.com` als
Fremdmandant für den Isolationstest. Passwort aus `SEED_PASSWORD`.
