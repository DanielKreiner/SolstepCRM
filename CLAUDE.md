# CLAUDE.md — Betriebssoftware für PV-Installationsbetriebe

Mandantenfähiges SaaS-Produkt (DACH, Zielkunde 8–40 Mitarbeiter).
Diese Datei ist die verbindliche Bauanleitung. Die fachliche Spezifikation steht in `docs/SPEC.md`.
Bei Widerspruch gilt: CLAUDE.md (technisch) > SPEC.md (fachlich) > Mockup (visuell).

---

## 0. Abgrenzung — das hier ist ein eigenes Produkt

**Dieses Produkt ist vollständig getrennt vom Solstep-Handelsgeschäft.** Kein gemeinsamer Code,
keine gemeinsame Datenbank, keine gemeinsamen Zugänge, keine gemeinsame Domain, keine
gemeinsame Absenderadresse. Solstep (PV-DIY-Shop) ist Handel, das hier ist Software.

Konkret durchzuhalten:

| Bereich | Regel |
|---|---|
| Repo | eigenes GitHub-Repo, nicht im Solstep-Repo, keine geteilten Packages |
| Supabase | eigene Organisation, eigenes Projekt (prod + staging), kein Zugriff auf Shop-Daten |
| Vercel | eigenes Projekt, eigene Domain |
| Mail | eigene Versanddomain, **nicht** `solstep.de` |
| Shopify / Shop | **keine** Verbindung, kein Import, kein gemeinsamer Kundenstamm |
| Solarplex / Fulfillment | keine Verbindung |
| Buchhaltung | eigener Kostenstellen- bzw. Mandantenkreis |

Der Produktname ist noch offen. Deshalb: **kein Produktname wird im Code hart verdrahtet.**
Alles läuft über `lib/brand.ts`:

```ts
export const BRAND = {
  name: process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Betrieb",
  legal: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "",
  domain: process.env.NEXT_PUBLIC_APP_URL!,
  supportMail: process.env.NEXT_PUBLIC_SUPPORT_MAIL!,
} as const;
```

Kein Literal des Produktnamens in Komponenten, Mails, PDF, Manifest oder Seitentiteln.
Ein Rebranding muss eine Änderung von drei Umgebungsvariablen sein, kein Refactoring.

Wichtig für das Datenmodell: **Der Betreiber der Software ist kein Mandant.**
Hofstätter Energietechnik GmbH ist ein Demo-/Pilotmandant im Seed, nicht der Eigentümer der
Instanz. Jede Abfrage geht über `company_id`, es gibt keinen impliziten Hauptmandanten.

---

## 0.a Ausgangslage

Im Repo liegen unter `design/` drei fertige HTML-Mockups aus Claude Design:

| Datei | Inhalt |
|---|---|
| `design/backoffice-v2.dc.html` | Backoffice, alle Screens |
| `design/kundenportal.dc.html` | Kundenportal (extern, Magic Link) |
| `design/mitarbeiter-app.dc.html` | Monteur-App 390px + Mitarbeiter-Desktop |

Die Dateien kommen aus Claude Design und tragen dort noch Solstep-Dateinamen.
Beim Import ins Repo umbenennen und alle Solstep-Vorkommen im Markup durch `BRAND.name` ersetzen.

Diese Dateien sind **visuelle Referenz und Quelle für Markup + Tokens**, nicht der Produktivcode.
Nicht 1:1 kopieren: Inline-Styles werden in Tailwind-Klassen und CSS-Variablen überführt (Abschnitt 9).
Aber: Abstände, Radien, Farben, Zeilenhöhen, Textinhalte und Zahlenformate **exakt übernehmen**.

Ziel dieses Builds: `pnpm dev` startet eine lauffähige App mit vollständigem Seed-Datensatz
(Hofstätter Energietechnik GmbH), in der jeder Screen aus den Mockups mit echten Daten aus der
Datenbank arbeitet. Kein Screen mit Dummy-Arrays im Frontend.

---

## 1. Stack

```
Next.js 15 (App Router) + TypeScript strict
Tailwind CSS 4 + CSS-Variablen-Tokens
TanStack Query 5   → Serverdaten, Cache, optimistische Updates
Zustand            → nur UI-State (Filter, Sidebar, Board-Drag, Undo-Queue)
Supabase (Region eu-central-1 / Frankfurt) → Postgres, Auth, Storage, Realtime
Vercel (Region fra1) → Hosting, Route Handlers, Cron
Serwist            → ServiceWorker/PWA für die Monteur-App
idb                → IndexedDB-Puffer für die Offline-Queue
@react-pdf/renderer → PDF (Angebot, Rechnung, Dienstplan, Stundenbericht)
nodemailer + imapflow → SMTP-Versand und IMAP-Abruf je Mandant
@microsoft/microsoft-graph-client → Mail und Kalender für M365-Mandanten
dnd-kit            → Board-, Timeline- und Dispo-Drag&Drop
Recharts           → Charts (Balken als Pills, Ringe via conic-gradient in CSS, nicht Recharts)
date-fns + date-fns-tz → Zeitrechnung, Anzeige in Europe/Vienna
zod                → Validierung an jeder Systemgrenze
Playwright         → E2E gegen den Seed
Vitest             → Unit, vor allem Zeit-/Arbeitsrechtsregeln
```

### Warum Next.js und nicht Vite-SPA

Abweichung von der sonstigen Hausregel, bewusst:
Diese App braucht Serverseite, die eine reine SPA nicht hat — IMAP-Abruf, SMTP-Versand, Microsoft-Graph-
Change-Notifications, Tracking-Pixel, PDF-Erzeugung, signierte Portal-Links, Cron-Jobs,
Buchhaltungsexport. Mit Vite bräuchte es einen zweiten Dienst. Next.js auf Vercel liefert das
in einem Deployment.

Regel dazu: **Route Handlers nur für Integrationen, Webhooks, PDF, Cron und Downloads.**
Alle normalen Lese- und Schreiboperationen laufen direkt über den Supabase-Client mit RLS.
Keine CRUD-API-Schicht bauen, die RLS nur doppelt.

---

## 2. Repo-Struktur

```
/app
  /(auth)/login
  /(app)/                        # Backoffice, Sidebar-Layout 246px
    cockpit/
    pipelines/[kind]/            # vertrieb | projekte | service
    auftraege/[id]/
    angebote/
    crm/
    lager/
    dispo/
    zeiterfassung/
    stundenkonto/
    rechnungen/
    abwesenheiten/
    mitarbeiter/[id]/
    dokumente/
    chat/
    bewerber/
    berichte/
    einstellungen/
  /(me)/                         # Mitarbeiter-Desktop-Selfservice
    heute/  meine-zeiten/  meine-dokumente/
  /m/                            # Monteur-PWA, eigenes Layout, 390px-first
    heute/  stempeln/  material/  auftrag/[id]/  abwesenheit/
  /portal/[token]/               # Kundenportal, kein Supabase-Login
    fortschritt/  angebot/  dokumente/  anliegen/  ertrag/
  /api
    /webhooks/graph/route.ts
    /webhooks/stripe/route.ts
    /oauth/microsoft/{start,callback}/route.ts
    /webhooks/step-planer/route.ts
    /track/open/[token]/route.ts     # 1x1 GIF
    /track/click/[token]/route.ts    # 302
    /pdf/quote/[id]/route.ts
    /pdf/invoice/[id]/route.ts
    /pdf/roster/[week]/route.ts
    /export/accounting/route.ts
    /cron/[task]/route.ts
/components
  /ui                            # Primitives: Pill, Card, Panel, RingStat, DataTable, InlineEdit, Toast
  /board  /timeline  /dispo  /charts
/lib
  /supabase/{client,server,admin,middleware}.ts
  /rules/{worktime,plausibility,dunning}.ts
  /mail/{send,fetch,parse,assign,crypto,templates,tracking}.ts   # frei von Next-Abhängigkeiten
                                                                 # -> auch aus einem Worker nutzbar
  /pdf/{quote,invoice,roster}.tsx
  /graph/{auth,sync,subscriptions}.ts
  /numbers.ts                    # Nummernkreise
  /money.ts  /time.ts  /format.ts
/supabase
  /migrations/*.sql
  seed.sql
/design                          # die .dc.html-Mockups, read-only Referenz
/docs/SPEC.md
```

---

## 3. Environment-Variablen

Die vollständige Vorlage liegt als `.env.local` im Repo-Root und ist dort kommentiert.
Zusätzlich `.env.local` in `.gitignore` prüfen, bevor der erste Commit rausgeht.

Kurzüberblick, welche Gruppen es gibt:

| Gruppe | Zweck | Pflicht |
|---|---|---|
| `NEXT_PUBLIC_*` | Branding, App-URL | ja |
| `SUPABASE_*` | DB, Auth, Storage, Management-API | ja |
| `MAIL_CRED_KEY` | Verschlüsselung der Postfach-Zugangsdaten | ja |
| `SYSTEM_MAIL_*` | Systempostfach des Betreibers (IMAP/SMTP) | ja |
| `MS_*` | Microsoft Entra App, Mail + Kalender der Mandanten | ja |
| `PORTAL_/SHARE_/TRACK_TOKEN_SECRET`, `CRON_SECRET`, `OPS_*` | signierte Links, Cron, Ops-Zugang | ja |
| `STEP_PLANER_*` | Planungsimport | optional |
| `STRIPE_*` | Abrechnung | optional, ab Mandant 2 |
| `MAPTILER_KEY` | Mini-Karte und Geocoding | optional |
| `SENTRY_DSN` | Fehler | optional |

Fehlt eine optionale Gruppe, zeigt das UI die Integration als „nicht verbunden" und die
zugehörigen Jobs überspringen sich. **Die App muss ohne jede optionale Integration vollständig
lauffähig sein** — harte Anforderung, keine Kür.

## 4. Supabase

### 4.1 Projekt

- Region **eu-central-1 (Frankfurt)**, Plan Pro (wegen PITR und Storage)
- Zeitzone der Datenbank auf UTC lassen, nicht umstellen
- Migrations ausschließlich über `supabase/migrations/*.sql`, nie über das Dashboard
- Lokal: `supabase start`, `supabase db reset` spielt Migrations + `seed.sql`

### 4.2 Mandantenfähigkeit und RLS

Jede Fachtabelle hat `company_id`. Zugriff wird **serverseitig über RLS** durchgesetzt,
das UI blendet nur zusätzlich aus.

- Beim Anlegen eines Nutzers wird `company_id` und `role` per Admin-API in
  `raw_app_meta_data` geschrieben (nicht `user_metadata` — das ist vom Client änderbar)
- Helper `public.current_company_id()` liest `auth.jwt() -> 'app_metadata' -> 'company_id'`
- Policies werden in der Migration per DO-Loop für alle Tabellen mit `company_id` erzeugt
- Rollenrechte (`none|read|write` je Bereich) liegen in `role_permission` und werden von
  `public.can(area, level)` ausgewertet — Policies für sensible Bereiche (Rechnungen, Zeitkonten,
  Mitarbeiterdokumente) rufen `can()` mit auf

### 4.3 Auth

- Backoffice und Mitarbeiter: Supabase Auth, E-Mail + Passwort, MFA optional
- Monteur-App: gleicher Auth, langlebige Session (Refresh 30 Tage), PIN-Sperre clientseitig
- **Kundenportal: kein Supabase-Auth.** Zugang über `/portal/[token]`, Token = HMAC über
  `customer_id + exp`, in `portal_access` gespeichert, optional 4-stellige PIN.
  Serverseitiges Laden ausschließlich mit dem Service-Role-Client und explizitem
  `where customer_id = …`. Der Portal-Pfad darf niemals den anon-Client benutzen.

### 4.4 Storage-Buckets

| Bucket | Öffentlich | Inhalt | Aufbewahrung |
|---|---|---|---|
| `documents` | nein | Verträge, Lohnzettel, Zertifikate, Netzanmeldung | dauerhaft |
| `job-photos` | nein | Baustellenfotos, Kundenuploads | dauerhaft |
| `quote-pdf` | nein | erzeugte Angebots-PDF + Canvas-Snapshot | dauerhaft |
| `invoice-pdf` | nein | Rechnungs-PDF, revisionssicher, kein Überschreiben | 7 Jahre |
| `avatars` | ja | Mitarbeiterfotos | dauerhaft |

Pfadschema immer `{company_id}/{entity}/{entity_id}/{uuid}-{filename}`.
Ausgabe an Clients nur über Signed URLs (60 min; Portal 15 min).

### 4.5 Realtime

Aktivieren für: `chat_message`, `time_entry`, `job` (Phasenwechsel für das Board),
`notification`. Sonst nichts — Realtime auf großen Tabellen kostet ohne Nutzen.

---

## 5. Datenmodell — die Entscheidungen, die vorher feststehen müssen

Vollständiges Schema: `supabase/migrations/0001_init.sql`. Diese sechs Punkte nicht abweichen:

1. **Die drei Pipelines sind Views auf drei verschiedene Entitäten**, nicht eine generische
   Pipeline-Tabelle:
   Vertrieb → `quote` (mit `customer.type = lead`), Projekte → `job`, Service → `service_ticket`.
   Board, Tabelle und Timeline sind drei Renderer über dieselbe geladene Liste. Ein gemeinsames
   TypeScript-Interface `PipelineCard` mappt die drei Entitäten auf Karte + erlaubte Phasenwechsel.

1a. **Phasen sind Stammdaten je Mandant, kein Enum.** Jeder Betrieb arbeitet anders — einer hat
   „Gerüst bestellt", der nächste nicht. `pipeline` und `pipeline_phase` sind pro Mandant
   editierbar (Einstellungen), `job.phase_id` zeigt darauf.
   **Automatiken hängen niemals am Label, sondern an `pipeline_phase.system_key`**
   (`won | lost | in_execution | ready_to_invoice | closed`). Nur diese fünf Semantiken darf der
   Code kennen. Ein Mandant, der eine Phase umbenennt, darf keine Automatik brechen.
   `seed_pipelines(company_id)` legt beim Onboarding die Standardphasen an.

2. **Geld** durchgehend `numeric(12,2)`, niemals `float`. Beträge netto speichern,
   Steuersatz je Position (`vat_rate`). Rundung kaufmännisch, immer erst auf Positionsebene.

3. **Zeit** durchgehend `timestamptz` in UTC. Anzeige und alle Tagesgrenzen in `Europe/Vienna`.
   `duration_min` wird serverseitig aus `started_at`/`ended_at` berechnet und in einem
   Generated Column gespiegelt — nie vom Client übernehmen.

4. **Zeitkorrekturen überschreiben nie.** Eine Korrektur erzeugt `time_correction` und, nach
   Genehmigung, einen neuen `time_entry` mit `replaces_id`. Der alte Eintrag wird auf
   `status = 'replaced'` gesetzt, nicht gelöscht.

5. **`audit_log` ist append-only.** Trigger auf `time_entry`, `stock_move`, `invoice`,
   `quote`, `absence`, `article`. Kein UPDATE/DELETE-Recht auf `audit_log` für irgendeine Rolle.

6. **Nummernkreise** über `public.next_number(company_id, kind, year)` mit
   `pg_advisory_xact_lock`. Keine Client-seitige Vergabe, keine Lücken durch Rollback tolerieren
   (Lücken sind erlaubt, Duplikate nicht).

---

## 6. Integrationen

### 6.1 Mail — eigenes Postfach des Mandanten, kein Versanddienst

**Kein Resend, kein SendGrid.** Jeder Mandant hängt sein eigenes Postfach ein. Das ist die
bessere Lösung für dieses Produkt, nicht nur die billigere:

- keine DNS-Arbeit je Kunde (kein SPF/DKIM/DMARC-Setup im Onboarding)
- Mails kommen aus der echten Firmenadresse, landen im „Gesendet"-Ordner des Betriebs
- Antworten des Kunden laufen ins normale Postfach **und** in die App
- keine geteilte Absenderreputation über alle Mandanten
- keine Versandkosten

Preis dafür: kein `delivered`-Event und keine Bounce-Webhooks. Zustellprobleme erkennst du nur
über eingehende Unzustellbarkeitsmeldungen. Das ist verkraftbar, muss aber im UI ehrlich stehen
(„gesendet" statt „zugestellt").

#### Zwei Provider

| Provider | Wofür | Versand | Empfang |
|---|---|---|---|
| `microsoft` | Microsoft 365 / Outlook | Graph `sendMail` | Graph Change-Notifications + Delta |
| `imap` | alles andere (A1, World4You, Easyname, Hosteurope, Gmail …) | SMTP über nodemailer | IMAP-Abruf |

Bei Microsoft 365 **kein IMAP/SMTP verwenden.** Basic Auth für IMAP/POP/EWS ist dort seit 2022
abgeschaltet, SMTP AUTH Basic Auth wird Ende Dezember 2026 standardmäßig deaktiviert.
Für M365 gilt: Graph oder gar nichts.

#### Zugangsdaten

`mail_account.secret_enc` hält Passwort bzw. Refresh-Token als **AES-256-GCM**, Schlüssel aus
`MAIL_CRED_KEY`, Format `iv || tag || ciphertext`. Entschlüsselung ausschließlich im Worker
und in Route Handlers, nie in einer Server Component. Die Tabelle ist für `authenticated`
gesperrt, das UI liest `v_mail_account` ohne Secret-Spalte.
Bei `provider = 'imap'` im UI klar sagen, dass ein **App-Passwort** zu verwenden ist, nie das
Hauptpasswort. Verbindungstest vor dem Speichern, sonst kein Speichern.

#### Versand

Alles geht über `mail_outbox`, nie direkt. Cron `mail-send` alle 2 Minuten:
Batch ziehen, senden, `message_id` zurückschreiben, bei Fehler `attempts + 1` und
exponentielles Backoff (2, 10, 60, 300 min), nach 5 Versuchen `failed` plus Benachrichtigung.
Bei IMAP zusätzlich die gesendete Mail per `APPEND` in den Sent-Ordner legen — sonst fehlt sie
dem Betrieb in Outlook.

#### Empfang und Zuordnung

Cron `mail-fetch` alle 5 Minuten je Konto:
IMAP über `UID SEARCH` seit `last_uid` (`uid_validity` prüfen, bei Änderung neu aufsetzen),
Microsoft über Delta-Token bzw. Change-Notification.

Zuordnung einer eingehenden Mail in dieser Reihenfolge:
1. **Reply-To-Token**: ausgehende Mails setzen `Reply-To: office+q7f3a2@…` bzw. bei fehlender
   Plus-Adressierung einen Token im `References`-Header. Treffer = eindeutig
2. `In-Reply-To` / `References` gegen `mail_message.message_id`
3. Absenderadresse gegen `customer.email`
4. sonst Posteingang „nicht zugeordnet" mit manueller Zuweisung in einem Klick

Jede zugeordnete Mail erzeugt eine `contact_activity` und erscheint in der Auftragstimeline.

#### Tracking

Ohne Versanddienst selbst gebaut, reicht vollkommen:
- Öffnung: `/api/track/open/[token]` liefert ein 1×1-GIF, schreibt `quote_event`.
  Öffnungen innerhalb von 5 Sekunden nach Versand als Scanner werten und nicht zählen
- Klick: `/api/track/click/[token]` protokolliert und leitet per 302 weiter
- Antwort des Kunden ist das stärkste Signal und kommt über den Mailabruf ohnehin herein

#### Systemmails

Einladungen, Passwort-Reset, Rechnungen an den Mandanten laufen über **ein eigenes Postfach des
Betreibers** (ebenfalls `mail_account`, aber ohne `company_id`-Bindung im Ops-Bereich).
Zugangsdaten aus `SYSTEM_MAIL_*` in der Env.

Alle Mailtexte deutsch, kein Gendern. Templates als React-Komponenten in `lib/mail/templates`,
table-basiertes HTML, gegen Outlook getestet.

Ablauf beim Angebotsversand:
1. PDF erzeugen, in `quote-pdf` legen
2. Kundenmail in `mail_outbox`: Bestätigung + PDF + Share-Link + Button „Angebot annehmen"
3. Teammail: Notification + PDF + Adminlink + Kundendaten
4. `quote_event` mit `kind = 'sent'`, `message_id` in `meta_json`
5. Erinnerung nach 7 Tagen ohne Reaktion über Cron `quote-reminders`, je Angebot abschaltbar

### 6.2 Microsoft Graph — Postfach und Kalender

Eine App-Registrierung für beides. **Multi-Tenant** (`signInAudience: AzureADMultipleOrgs`),
denn die Mandanten haben eigene M365-Tenants. Nicht Client-Credentials auf deinem eigenen
Tenant — das war im ersten Entwurf falsch für ein Mietmodell.

- Authorization-Code-Flow mit `offline_access`, Refresh-Token je `mail_account` verschlüsselt
- Delegated Scopes: `offline_access User.Read Mail.Send Mail.ReadWrite Calendars.ReadWrite`
- Admin-Consent-Link im Onboarding, falls der Kunde Consent zentral steuert
- Redirect-URI: `{APP_URL}/api/oauth/microsoft/callback`
- Je Auftrag ein Event beim Bauleiter, je Dispo-Block ein Event beim Monteur
- Change-Notification-Subscriptions je Postfach, Endpoint `/api/webhooks/graph`,
  `validationToken`-Handshake beachten. **Ablauf nach maximal 4230 Minuten** → Cron
  `graph-renew` alle 12 Stunden erneuert alle aktiven Subscriptions
- Konflikte nicht automatisch auflösen: `job_appointment.sync_state = 'conflict'`
- Delta-Token je Kalender und je Postfach persistieren

### 6.3 Step-Planer — Planungsimport

Zwei Wege, beide bauen:
- **Push**: Webhook `/api/webhooks/step-planer` mit HMAC-Signatur, Payload = Planungs-JSON
- **Pull/Manuell**: Upload einer Planungs-JSON im Angebotsdialog

Verarbeitung:
1. Payload gegen ein zod-Schema validieren (Module, Wechselrichter, Speicher,
   Unterkonstruktion, Kabelwege, Ertrag, CO₂)
2. Mapping auf Artikel über `article.sku` bzw. `article_alias`
3. **Vorschau-Diff anzeigen**, nie still importieren: „12 Positionen erkannt, 2 nicht zuordenbar".
   Nicht zuordenbare Positionen werden als Freitextposition angelegt und rot markiert
4. Canvas-Snapshot als 800×800 JPEG (Qualität 82) in `quote-pdf` ablegen

### 6.4 PDF

`@react-pdf/renderer` in Node-Runtime-Route-Handlers, **kein Puppeteer/Chromium** —
zu langsam und zu teuer im Serverless-Kaltstart.
Firmenlayout aus `company.pdf_settings` (Logo, Farben, Fußzeile, Bankdaten).
Angebots-PDF: technischer Teil **ohne Preise**, Preisteil als separater Block.
Rechnungs-PDF nach Erzeugung unveränderlich; Korrektur nur über Storno + Neuausstellung.

### 6.5 Buchhaltung

Nächtlicher Cron `accounting-export` erzeugt BMD-/DATEV-kompatibles CSV (Konten, Buchungssätze,
Steuerschlüssel) und legt es in `documents/{company_id}/export/`. Konfiguration der Konten in
den Einstellungen. Kein direkter API-Zwang.

### 6.6 Lieferanten

Bestellung als PDF + CSV per Mail an die Lieferantenadresse. Optionaler API-Adapter pro
Lieferant hinter einem Interface `SupplierAdapter { availability(), price() }` — vorerst nur
die Mail-Implementierung bauen.

---

## 7. Vercel

Das Deployment macht Daniel selbst: GitHub-Repo mit Vercel verbinden, Push auf `main` = Produktion.
Claude Code deployt nicht und legt kein Vercel-Projekt an — aber `vercel.json` und die
Env-Vorlage müssen so im Repo liegen, dass der erste Push ohne Nacharbeit durchläuft.

- Projekt-Region **fra1**, Framework Preset Next.js
- Node-Runtime (nicht Edge) für alles unter `/api/pdf`, `/api/export`, `/api/webhooks`
- `NEXT_PUBLIC_*` in allen Umgebungen, Secrets nur in Production und Preview
- Preview-Deployments zeigen auf ein **separates Supabase-Projekt** (`<produkt>-staging`),
  niemals auf Produktivdaten
- Deployment Protection für Preview aktivieren
- Für die Crons ist **Vercel Pro nötig** (Hobby erlaubt nur tägliche Jobs)

`vercel.json`:

```json
{
  "regions": ["fra1"],
  "crons": [
    { "path": "/api/cron/quote-reminders",   "schedule": "0 6 * * 1-5" },
    { "path": "/api/cron/dunning",           "schedule": "30 5 * * 1-5" },
    { "path": "/api/cron/stock-check",       "schedule": "0 * * * *" },
    { "path": "/api/cron/certificate-check", "schedule": "0 4 * * *" },
    { "path": "/api/cron/graph-renew",       "schedule": "0 */12 * * *" },
    { "path": "/api/cron/mail-send",         "schedule": "*/2 * * * *" },
    { "path": "/api/cron/mail-fetch",        "schedule": "*/5 * * * *" },
    { "path": "/api/cron/accounting-export", "schedule": "0 1 * * *" },
    { "path": "/api/cron/monthly-timesheet", "schedule": "0 3 1 * *" }
  ]
}
```

Alle Cron-Zeiten in **UTC** — die Werte oben ergeben 7:00/6:30 Ortszeit im Winter,
8:00/7:30 im Sommer. Das ist akzeptiert; keine Sommerzeitkorrektur einbauen.
Jeder Cron-Handler prüft `Authorization: Bearer ${CRON_SECRET}` und ist **idempotent**
(Vercel kann doppelt zustellen) — Idempotenz über eine `job_run(kind, run_key unique)`-Tabelle.

**Zum Mailabruf per Cron statt IMAP IDLE:** IDLE braucht eine dauerhafte Verbindung, die es auf
Vercel nicht gibt. Abruf alle 5 Minuten ist für einen Handwerksbetrieb völlig ausreichend.
Erst wenn ein Mandant echte Sekunden-Reaktion verlangt, kommt ein kleiner Dauerworker dazu
(Hetzner CX22, rund 4 € im Monat) — dann wandern `mail-fetch` und `mail-send` dorthin,
der Rest bleibt unverändert. Deshalb die Mail-Logik in `lib/mail/` als reine Funktionen bauen,
die sowohl aus dem Cron-Handler als auch aus einem Worker aufrufbar sind.

`mail-send` und `mail-fetch` laufen minütlich bzw. alle 5 Minuten. Der Cron-Handler holt sich
zuerst ein `pg_try_advisory_lock`, damit sich überlappende Läufe nicht in die Quere kommen.

---

## 8. Monteur-PWA und Offline-Queue

- Serwist-ServiceWorker, nur `/m/*` wird offlinefähig
- App-Shell + letzte 7 Tage eigener Aufträge, Artikelstammdaten und offene Zeitbuchungen
  in IndexedDB vorhalten
- Jede schreibende Aktion geht zuerst in `queue` (IndexedDB) mit
  `{ id: uuid, kind, payload, client_ts, attempts }`, danach optimistisch ins UI
- Versand über Background Sync, Fallback: Retry beim nächsten `online`-Event
- **Zeitstempel werden clientseitig erfasst** (`client_ts`) und serverseitig plausibilisiert:
  Abweichung Client-/Serverzeit > 15 min → `time_entry.status = 'flagged'`
- Konflikt: Server gewinnt bei Stammdaten, Client gewinnt bei Zeitstempeln
- Banner „Offline — 3 Buchungen werden nachgesendet", Warteschlange mit Typ und Zeit einsehbar
- Der laufende Timer läuft lokal weiter und wird beim Ausstempeln als Paar übertragen
- Touchziel ≥ 56px, Barcode-Scan über `BarcodeDetector` mit `@zxing/browser` als Fallback

---

## 9. Design-Tokens und Umgang mit den Mockups

Erster Arbeitsschritt vor jedem Screen: `app/tokens.css` aus den Mockups erzeugen.

```css
:root {
  --app:#EAE6E0; --panel:#F8F6F3; --surface:#FFFFFF; --sunk:#F2EEE9; --line:#EAE4DC;
  --text:#151210; --text-2:#6A625A; --text-3:#9C9289;
  --accent:#E8952B; --accent-from:#F2A73F; --accent-to:#C97918;
  --s-new:#8B92A0; --s-doing:#3E7BC6; --s-waiting:#8465C4;
  --s-done:#3E9E6B; --s-warn:#E8952B; --s-crit:#D2543F;
  --r-panel:26px; --r-card:19px; --r-pill:99px; --r-input:14px;
  --shadow:0 1px 2px rgba(21,18,16,.04), 0 8px 24px rgba(21,18,16,.04);
  --ease:cubic-bezier(.2,0,0,1);
}
[data-theme="dark"]{
  --app:#0C0B0A; --panel:#151211; --surface:#1D1917; --sunk:#221E1B; --line:#2A2522;
  --text:#F2EEE9; --text-2:#A79E95; --text-3:#7A726A;
}
```

Regeln:
- Schriften: **Inter Tight** (UI) und **JetBrains Mono** (`font-variant-numeric: tabular-nums`)
  für alle Zahlen, Zeiten, IDs, Beträge, Artikelnummern — ohne Ausnahme
- Tailwind-Theme mappt auf die Variablen (`bg-surface`, `text-muted`, `rounded-card`),
  keine Hex-Werte in Komponenten
- Statusdarstellung immer Pill mit Fläche **und** Text, nie Farbe allein
- Bewegung 160–220 ms, Drag hebt 4 px mit 3° Neigung, Skeletons statt Spinner,
  KPI-Zahlen zählen beim Laden hoch
- Sidebar 246 px, Content max 1680 px, Tabellenzeile 44 px / 36 px kompakt

**Nicht bauen:** leere States als Hauptdarstellung, Chatbot-Sidebar, Karussells,
Hero-Illustrationen, Emoji als Icons, Modals für Dinge die inline gehen,
mehr als drei Akzentelemente pro Screen.

---

## 10. Konventionen

- **Sprache:** alle UI-Texte, Fehlermeldungen, Mails und PDF deutsch, **kein Gendern**,
  keine Füllphrasen. Texte zentral in `lib/strings.ts`, kein i18n-Framework
- **Inline-Edit statt Modal:** Feld übernimmt optimistisch, Undo-Toast 8 Sekunden,
  bei Fehler Rollback und rote Zeilenmarkierung
- **Undo:** jede destruktive Aktion über `useUndoableMutation`, Ausführung erst nach 8 s
  oder sofort bei Navigation
- **Command-Palette ⌘K** auf jedem Screen: Sprung zu Auftrag, Person, Artikel + ausführbare
  Aktionen. Volltextsuche über eine `search_index`-View mit `pg_trgm`
- **Tabellen:** Filter, Sortierung und Pagination **serverseitig**, URL-State als Single Source
  of Truth (`?phase=&standort=&von=&bis=`), damit Links teilbar sind
- **Fehler:** kein stiller Fehler. Toast mit Klartext, Sentry-Event, Retry-Button
- **Mandantentrennung** ist testpflichtig: `tests/isolation.spec.ts` prüft für jede Tabelle,
  dass Mandant A nichts von B sieht, schreibt oder über Joins erreicht. Läuft in CI bei jedem PR
- **Arbeitsrechtsregeln** (Ruhezeit 11 h, Höchstarbeitszeit, Pausenpflicht) als reines
  Regelmodul `lib/rules/worktime.ts`, pro Standort konfigurierbar, mit Vitest-Tests.
  Das Modul wird an drei Stellen benutzt: Dispo-Konfliktprüfung, Zeiterfassungs-Plausibilität,
  Dienstplanveröffentlichung. Keine dritte Implementierung dulden

---

## 11. Sicherheit

- Service-Role-Key niemals in einer Datei unter `app/` importieren, die nicht `route.ts` oder
  `"use server"` ist. ESLint-Regel dafür einrichten
- Alle Webhooks mit Signaturprüfung, Zeitfenster 5 min, Replay-Schutz über Event-ID
- Portal-Token: HMAC, Ablauf 90 Tage, widerrufbar, Rate-Limit 30 Requests/Minute je Token
- Upload: Whitelist `pdf, jpg, png, heic, webp, csv, xlsx`, max 25 MB, Content-Type
  serverseitig prüfen, EXIF-GPS aus Kundenfotos entfernen
- Rechteprüfung immer serverseitig, `can()` im UI nur zusätzlich
- DSGVO: Löschkonzept je Kunde (`customer.deleted_at` + Anonymisierung, Rechnungen bleiben
  wegen Aufbewahrungspflicht bestehen)

---

## 12. Umsetzungsreihenfolge

Je Meilenstein gilt: Migration + Seed + Screen + Playwright-Test, dann erst der nächste.

| # | Meilenstein | Definition of Done |
|---|---|---|
| 0 | Fundament | Repo, Tokens, UI-Primitives, Supabase-Projekt, Auth, RLS, **RLS-Isolationstest mit zwei Mandanten grün**, Seed läuft, Login funktioniert |
| 1 | Auftrag, Kunde, Artikel, Zeiterfassung, Materialbuchung | Zeitbuchung mit Auftragsbezug erzeugt korrekten Saldo, Materialentnahme senkt Bestand |
| 2 | Pipelines Board/Tabelle/Timeline + Auftragsdetail | Drag ändert Phase serverseitig, Filter in der URL, Ringkennzahlen stimmen |
| 3 | Angebote inkl. Step-Planer-Import, PDF, Mailversand, digitale Annahme | Annahme legt Auftrag an und erzeugt Aufgabe „Termin fixieren" |
| 4 | Lager: Bewegungen, Bestellungen, Bestellvorschlag | Vorschlag aus Bedarf terminierter Aufträge + Mindestbestand, Mailversand an Lieferant |
| 5 | Monteur-PWA inkl. Offline-Queue | Flugmodus-Test: 3 Buchungen offline, nach Reconnect vollständig und korrekt |
| 6 | Einsatzplanung mit Konfliktprüfung | Ruhezeitverletzung blockt Veröffentlichung bis zur Bestätigung |
| 7 | Rechnungen, Mahnlauf | Teilrechnungslogik Anzahlung/Montage/Schluss, Mahnstufen automatisch |
| 8 | Kundenportal | Magic Link, Angebotsannahme mit Name/IP/Zeit, Ticket-Erzeugung |
| 9 | CRM-Pipelines, Service-Tickets | Aktivitäten laufen automatisch ein (Portal, Mail, Angebotsstatus) |
| 10 | Personal: Abwesenheiten, Stundenkonto, Dokumente, Mitarbeiter-Desktop | Jahresplaner, Resturlaub, Korrekturworkflow, E-Signatur-Status |
| 11 | Chat, Bewerber, Berichte, Einstellungen | Rollenmatrix wirkt serverseitig, Phasen je Mandant editierbar, Berichte exportieren nach Excel/PDF |
| 12 | SaaS-Betrieb | `/ops`, Provisioning, CSV-Import, Stripe, Usage-Meldung, Export-ZIP, Restore-Übung dokumentiert |

---

## 12.a SaaS-Betrieb

Das Produkt wird vermietet. Damit ist der Betrieb Teil des Produkts, nicht Nacharbeit.

### Mandantenmodell

Ein Postgres, geteilte Tabellen, Trennung über `company_id` + RLS. Keine Datenbank je Mandant —
das skaliert bei Migrations und Kosten nicht. Preis dieser Entscheidung: **eine fehlerhafte
Policy ist ein Datenleck über alle Kunden.** Deshalb:

- **RLS-Isolationstest als CI-Gate.** Zwei Mandanten im Testseed, für jede Tabelle wird geprüft,
  dass Mandant A keine Zeile von B sieht, nicht schreibt und nicht über Joins durchgreift.
  Der Test läuft bei jedem PR. Neue Tabelle ohne Test = roter Build.
- Kein Query im Anwendungscode mit dem Service-Role-Key, außer in der Liste erlaubter Pfade
  (`/api/webhooks`, `/api/cron`, `/portal`, `/ops`). ESLint-Regel dafür.
- `company.status` steuert Schreibrechte über `tenant_writable()` **in der Policy**, nicht im UI.
  Bei `readonly` bleibt alles lesbar und exportierbar, nichts wird gelöscht.

### Betreiber-Backoffice `/ops`

Eigener Bereich, nur für den Betreiber, eigene Auth (getrennt von Mandanten-Auth, MFA Pflicht):
Mandantenliste mit Status, Seats, letzter Aktivität, Speicherverbrauch, Fehlerquote,
Mandant anlegen, Plan ändern, Testphase verlängern, Nutzungsdaten, Mailstatus je Domain.

**Support-Zugriff nur über `support_session`:** Grund eintragen, Laufzeit maximal 24 Stunden,
Standard nur lesend, Freigabe durch den Mandanten erforderlich. Jeder Zugriff landet im
`audit_log` und **ist für den Mandanten sichtbar**. Das ist kein Feature für den Betreiber,
sondern das Argument, mit dem du im Verkaufsgespräch die Frage „wer sieht unsere Lohndaten"
beantwortest.

### Grenzen je Mandant

Speicherquote (`company.storage_quota_mb`, Standard 20 GB), Mailkontingent je Monat,
Rate-Limit je Mandant auf API und Portal, maximale Dateigröße. Bei Überschreitung Warnung an
den Mandanten, kein stiller Abbruch. Ein Mandant darf die Plattform für andere nicht ausbremsen.

### Onboarding und Datenmigration

Der größte Grund für einen Abbruch ist nicht der Preis, sondern dass der Altbestand nicht
mitkommt. Deshalb ab Meilenstein 1 mitbauen:

1. `company` anlegen, Standardstandort, Rollenmatrix, Nummernkreise, `seed_pipelines()`
2. Ersten Nutzer als `gf` über die Supabase-Admin-API mit
   `app_metadata = { company_id, role }` anlegen und einladen
3. Postfach einhängen: Microsoft-OAuth oder IMAP/SMTP mit Verbindungstest
4. CSV-Import für Kunden, Artikel, offene Aufträge, Mitarbeiter — mit Spaltenmapping,
   Vorschau-Diff und Rollback, gleiche Mechanik wie beim Step-Planer-Import
5. Setup-Checkliste im UI mit Fortschritt, bis `company.onboarded_at` gesetzt ist
6. Demomandant mit vollständigem Datensatz für Verkaufsgespräche, per Klick zurücksetzbar

### Exit

Vollständiger Selfservice-Export als ZIP (CSV je Tabelle plus alle Dateien aus dem Storage).
Das ist DSGVO-Pflicht und gleichzeitig Verkaufsargument — „du kommst jederzeit wieder raus"
nimmt bei Handwerksbetrieben eine echte Kaufhürde weg.
Löschung 30 Tage nach Kündigung, vorher jederzeit Download möglich.

### Abrechnung

Stripe. Grundgebühr je Mandant plus Preis je aktivem Nutzer, zwei Nutzerklassen
(Vollzugang Büro/Bauleitung, günstiger Zugang Monteur — der Markt rechnet so, siehe unten).
Monatlicher Cron schreibt `usage_snapshot` und meldet die Menge an Stripe.
Zahlungsverzug → `status = 'readonly'`, niemals Löschung.

### Versionierung und Rollout

Ein Deployment für alle Mandanten. Daraus folgt:
- Migrations immer abwärtskompatibel in zwei Schritten (erst Spalte hinzufügen und doppelt
  schreiben, später alte Spalte entfernen). Keine Migration, die die App kurz kaputt macht
- Neue Funktionen hinter `company.feature_flags`, Rollout zuerst auf einen Mandanten
- Wartungsfenster gibt es nicht; ein Handwerksbetrieb stempelt um 6:30 ein

### Verfügbarkeit und Wiederherstellung

- Supabase PITR aktiviert, **Restore-Übung einmal durchspielen und dokumentieren**, bevor der
  erste zahlende Mandant onboardet. Ein Backup, das nie zurückgespielt wurde, ist kein Backup
- Wiederherstellung eines einzelnen Mandanten: Restore in ein temporäres Projekt,
  Extraktion über `company_id`, Rückspielen. Skript dafür in `scripts/restore-tenant.ts`
- Statusseite und Incident-Vorlage. Zugesagte Verfügbarkeit erst nennen, wenn sie gemessen wird
- Uptime-Monitor auf `/api/health` (prüft DB, Storage, Mailanbieter)

### Preisrahmen und Deckungsbeitrag

Marktlage DACH 2026: Handwerkersoftware liegt zwischen etwa 15 und 120 € je Nutzer und Monat,
gängige Cloud-Anbieter starten bei rund 29–79 € pro Monat. Üblich sind gestaffelte
Lizenzklassen (Vollnutzer teurer, App-Nutzer für Monteure deutlich günstiger).
Ein Zehn-Personen-Betrieb landet insgesamt schnell bei 200–250 € im Monat.

Daraus abgeleiteter Rahmen für die Kalkulation (kein Marketingpreis, sondern Rechengröße):
Grundgebühr 79 €, Vollnutzer 29 €, Monteurzugang 12 €. Ein Betrieb mit 2 Büro, 2 Bauleitung
und 8 Monteuren ergibt rund 290 € im Monat.

Variable Kosten je Mandant: Datenbank- und Storage-Anteil, Mailvolumen, PDF-Erzeugung.
Realistisch unter 10 € im Monat — der Deckungsbeitrag ist nicht das Problem.
**Das Problem ist die Akquisitionszeit:** Vertrieb, Datenmigration und Schulung bei einem
Handwerksbetrieb kosten leicht 15–25 Stunden. Bei 290 € Monatsumsatz amortisiert sich das
erst nach vielen Monaten. Onboarding-Automatisierung ist deshalb ein wirtschaftliches
Kernfeature, kein Komfort.

---

## 12.b Datenschutz — der ernsteste Punkt am ganzen Produkt

Die Software verarbeitet Arbeitszeiten, Standortbezug über Aufträge, Qualifikationen und
**Krankenstände**. Krankenstand ist ein Gesundheitsdatum nach Art. 9 DSGVO. Das hebt die
Anforderungen deutlich über das übliche B2B-SaaS-Niveau.

Vor dem ersten echten Mandanten muss vorliegen:

- **Auftragsverarbeitungsvertrag** (Art. 28) als Standarddokument, vom Anwalt geprüft
- **TOM-Dokument** (technische und organisatorische Maßnahmen), das zur Realität passt
- **Löschkonzept** je Datenart mit Fristen (Zeitdaten 7 Jahre wegen AZG/Abgabenordnung,
  Bewerberdaten 6 Monate, Kundenfotos nach Projektabschluss + X)
- **Verzeichnis von Verarbeitungstätigkeiten**
- Hinweis an die Mandanten, dass Zeiterfassung mit Kontrollcharakter in Österreich
  betriebsvereinbarungs- bzw. zustimmungspflichtig sein kann (§ 96 ArbVG). Das ist die
  Pflicht des Mandanten, aber du solltest eine Mustervorlage mitliefern — das nimmt im
  Verkaufsgespräch eine echte Hürde weg.

Technisch daraus abgeleitet, hart im Code:

- Krankenstand nur als `absence.kind = 'sick'`, **niemals Diagnose- oder Freitextfelder**
  für Krankheitsgründe. Kein Feld dafür bauen, auch nicht optional.
- Standortdaten nur auftragsbezogen, **kein Live-GPS-Tracking der Monteure**. Der Auftrag
  liefert die Adresse, das Gerät liefert keine Position.
- Zugriff auf fremde Zeit-, Abwesenheits- und Dokumentdaten nur mit `can(...)`, per RLS
  erzwungen (steht bereits in `0001_init.sql`)
- Alle Unterauftragsverarbeiter in der EU: Supabase Frankfurt, Vercel fra1, Sentry EU.
  Mail läuft über das Postfach des Mandanten, also gar kein zusätzlicher Verarbeiter. **Kein Dienst ohne EU-Datenresidenz einbauen**, auch kein Analytics-Tool

---

## 13. Was Claude Code nicht tun soll

- Keine generische CRUD-Abstraktion über alle Tabellen bauen
- Keine UI-Bibliothek einziehen, die eigene Optik mitbringt (kein MUI, kein Chakra, kein
  shadcn-Standardtheme ohne Token-Umbau)
- Keine KI-Automatik ohne Freigabe: KI erscheint ausschließlich als Vorschlagskarte im
  Arbeitsfluss mit „Übernehmen" / „Ablehnen"
- Keine Preise im technischen Datenblatt-Teil des Angebots-PDF
- Keine Mock-Daten im Frontend, sobald die zugehörige Tabelle existiert
- Kein Refactoring der Mockup-Optik „zur Verbesserung"

---

## 14. Was vor dem Start eingerichtet sein muss

Alles neu und getrennt vom Solstep-Handelsgeschäft anlegen, keine bestehenden Konten mitbenutzen.

| Dienst | Zweck | Kosten/Monat | Status |
|---|---|---|---|
| Produktname + Domain | Marke, App-Domain, Mailversand | ~15 €/Jahr | ☐ **blockiert den Start** |
| GitHub-Repo (eigenes) | Code | — | ☐ |
| Supabase Pro, Frankfurt (eigene Org) | DB, Auth, Storage, Realtime | ca. 25 $ | ☐ |
| Supabase Free, Staging | Preview-Deployments | 0 $ | ☐ |
| Vercel Pro (eigenes Projekt) | Hosting, Cron, Preview-Protection | 20 $ | ☐ |
| Eigenes Systempostfach (IMAP/SMTP) | Einladungen, Rechnungen an Mandanten | im Hosting enthalten | ☐ |
| Microsoft Entra App-Registrierung (multi-tenant) | Outlook-Mail + Kalender der Mandanten | 0 $ | ☐ |
| Stripe | Abrechnung ab Mandant 2 | transaktionsabhängig | ☐ |
| Uptime-Monitor + Statusseite | Verfügbarkeitsnachweis | 0–10 $ | ☐ |
| Sentry EU | Fehler | 0–26 $ | ☐ optional |
| Fonts: Inter Tight, JetBrains Mono | self-hosted via `next/font/local` | — | ☐ |
| AVV, TOM, Löschkonzept, VVT | Rechtsgrundlage vor Mandant 1 | Anwaltskosten | ☐ |

Laufende Basiskosten ohne Optionales: rund 65 $ im Monat.
Der Produktname blockiert den Start nicht technisch — `BRAND` läuft mit Platzhalter —,
aber Domain und Mailverifizierung brauchen Vorlauf, also früh entscheiden.
