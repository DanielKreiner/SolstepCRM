# Solstep Betrieb — Implementierungs-Spezifikation

Betriebssoftware für PV-Installationsbetriebe (DACH, 8–40 Mitarbeiter). Sprache durchgehend Deutsch, kein Gendern. Diese Datei ist die Bauanleitung für Claude Code. Die Designvorlagen liegen im Projekt als Design Components:

| Datei | Inhalt |
|---|---|
| `Solstep Betrieb v2.dc.html` | Backoffice-Web-App, alle Screens |
| `Solstep Kundenportal.dc.html` | Kundenportal (extern, ohne Login-Zwang über Magic Link) |
| `Solstep Mitarbeiter App.dc.html` | Monteur-App (Handy 390px) + Mitarbeiter-Desktop-Selfservice |

Referenzdaten in allen Mockups: Hofstätter Energietechnik GmbH, Oberpullendorf / Wiener Neustadt / Graz. Diese Datensätze als Seed übernehmen.

---

## 1. Leitprinzipien

1. **Der Auftrag ist die zentrale Entität.** Jede Zeit-, Material-, Dokument- und Rechnungsbuchung hat eine `auftrag_id`. Zeiterfassung ohne Auftragsbezug ist wertlos.
2. **Ein Datensatz, viele Sichten.** Pipeline-Board, Tabelle und Timeline sind Views auf dieselbe Entität, kein separater Datenbestand.
3. **Alles ist ein Link.** Zeitbuchung → Auftrag → Kunde → Angebot → Rechnung → Artikel → Lieferschein.
4. **Inline bearbeiten statt Modal.** Felder in Tabellen und Karten sind direkt editierbar (`contenteditable`-Muster im Mockup, im Code Inline-Edit-Feld mit optimistischem Speichern + Undo-Toast 8 s).
5. **Offline zuerst am Handy.** Monteur-App puffert Buchungen lokal und sendet nach (Screen „Offline im Keller").
6. **Keine KI-Automatik ohne Freigabe.** KI erscheint nur als Vorschlagskarte im Arbeitsfluss mit „Übernehmen" / „Ablehnen".

---

## 2. Rollen und Zugänge

| Rolle | Zugang | Kernaufgabe |
|---|---|---|
| Geschäftsführung | Desktop | Cockpit, Berichte, Freigaben |
| Büro / Disposition | Desktop breit | Pipelines, Angebote, Rechnungen, Zeiterfassung, Einsatzplanung |
| Bauleitung | Desktop + Tablet | Aufträge, Dispo, Abnahmen, Freigaben |
| Monteur | Handy, Mitarbeiter-Desktop | Stempeln, Material, Auftragsdetail, Abwesenheit |
| Lager | Tablet | Bestand, Kommissionierung, Wareneingang |
| Kunde | Kundenportal (Web-Link) | Fortschritt, Angebot annehmen, Bilder, Anliegen |

Rechte über Rollen-Matrix mit drei Zuständen: `none` / `read` / `write`, je Bereich (Pipelines, Angebote, CRM, Lager, Rechnungen, Zeiterfassung, Mitarbeiter). Siehe Einstellungen-Screen.

---

## 3. Datenmodell (Minimum)

```
company(id, name, ...)
location(id, company_id, name, holiday_region, worktime_rules)
user(id, company_id, location_id, name, role, weekly_hours, employment_type, hourly_cost)
qualification(id, user_id, name, valid_until)            -- Ablaufwarnung 120 Tage vorher

customer(id, company_id, type[lead|customer], name, address, lat, lng, email, phone, source)
contact_activity(id, customer_id, user_id, kind[call|mail|portal|note], body, created_at)

plant(id, customer_id, kwp, storage_kwh, modules, inverter, meter_point)

quote(id, customer_id, number, status[draft|sent|opened|accepted|lost|expired],
      net_total, margin_pct, valid_until, planner_ref, share_token, sent_at, accepted_at,
      accepted_ip, accepted_name)
quote_item(id, quote_id, pos, article_id, text, qty, unit, purchase_price, sale_price)
quote_event(id, quote_id, kind[created|sent|delivered|opened|pdf_downloaded|link_clicked|accepted|reminded],
            meta_json, created_at)

job(id, customer_id, quote_id, number, phase, site_manager_id, planned_hours, value_net,
    scheduled_from, scheduled_to, status)
job_checklist_item(id, job_id, label, done, done_at, done_by)
job_document(id, job_id, kind[quote|delivery_note|photo|handover|invoice|grid|other], file, visible_to_customer)

article(id, sku, name, manufacturer, category, unit, stock, min_stock, location_code,
        purchase_price, sale_price)
article_supplier(id, article_id, supplier_id, price, lead_days, framework_contract)
stock_move(id, article_id, job_id, user_id, qty, kind[out|return|goods_in|correction], created_at)
purchase_order(id, supplier_id, number, status[draft|open|confirmed|shipped|received], due_date)
purchase_order_item(id, purchase_order_id, article_id, qty)

time_entry(id, user_id, job_id, kind[work|travel|break|errand|training|leave_comp],
           started_at, ended_at, duration_min, note, status[running|booked|approved|flagged])
time_correction(id, time_entry_id, user_id, requested_change_json, reason, status, approver_id)
absence(id, user_id, kind[vacation|sick|leave_comp|care|school|special], from_date, to_date,
        status[requested|approved|rejected], substitute_id)

invoice(id, job_id, number, kind[deposit|partial|final], amount_net, due_date,
        status[draft|sent|partial|paid|overdue], dunning_level)
service_ticket(id, customer_id, job_id, plant_id, source[portal|phone|mail], category,
               severity, status, assignee_id, body, response)

applicant(id, position, name, stage, rating, next_appointment)
chat_channel(id, name, job_id nullable) / chat_message(id, channel_id, user_id nullable,
             system_kind nullable, body, created_at)
```

Alle Tabellen mit `company_id` (Mandantenfähigkeit) und Audit-Feldern (`created_at`, `created_by`, `updated_at`). Änderungen an Zeit-, Material- und Rechnungsdaten revisionssicher in `audit_log` (unveränderbar, Vorher/Nachher-Wert, Nutzer, Zeitstempel).

---

## 4. Screens Backoffice

### 4.1 Cockpit
4 KPI-Karten (erste als Akzentkarte): Auftragsbestand €, Auslastung 4 Wochen %, Stunden Woche ist/soll, offene Rechnungen. Darunter: Auslastungs-Balkenchart 8 Wochen mit Kapazitätslinie, nächster Termin mit Sprung zum Auftrag, Handlungsbedarf-Liste (Unterbesetzung, überfällige Rechnung, ablaufende Zertifikate, Material unter Mindestbestand), Team-heute-Liste mit Live-Status, Pipeline-Fortschrittsring, laufende Zeit als dunkle Karte.

Zahlen beim Laden hochzählen, Skeletons statt Spinner.

### 4.2 Pipelines (Kernscreen)
Umschaltbar zwischen drei Pipelines, jede mit eigenen Phasen:

- **Vertrieb**: Lead neu · Qualifiziert · Angebot gesendet · Angenommen · Verloren
- **Projekte**: Beauftragt · Material bestellt · Terminiert · In Montage · Netzanmeldung · Abgenommen · Fakturiert
- **Service**: Meldung offen · Diagnose · Termin geplant · Behoben

Views: **Board** (Drag & Drop zwischen Phasen, Karte hebt 4px, Zielspalte gestrichelter Akzentrahmen), **Tabelle** (dichte Zeilen 44/36px umschaltbar, inline editierbar, gruppierbar), **Timeline** (Balken über Kalenderwochen, in Dauer ziehbar).

Karte zeigt: Nummer (Mono), Kunde, Ort + Anlagengröße, Wert, nächster Schritt, Fortschritt Stunden ist/soll, Avatar-Stack, Deckungsbeitrag-Ampel, Statuspill der Phase.

Filter-Chips: Standort, Verantwortlich, Zeitraum, Status — toggeln aktiv/inaktiv und wirken serverseitig.

### 4.3 Auftragsdetail
Kopf: Nummer, Statuspills, Kunde, Adresse mit Mini-Karte, Anlage, Bauleiter, Team, Auftragswert. Drei Ringkennzahlen: Stunden ist/soll, Material ist/kalkuliert, Deckungsbeitrag.

Tabs: Übersicht (Aktivitätstimeline, Checkliste, Kundenportal-Ereignisse) · Kalkulation · Material (geplant/entnommen/zurück/Delta, roter Marker bei Abweichung, Lieferschein erzeugen) · Zeiten (Buchungen gruppiert nach Tag) · Termine (Outlook-Sync-Status) · Dokumente (Liste + Fotogrid) · Rechnung (Teil- und Schlussrechnung) · Verlauf (Audit-Log).

### 4.4 Angebote mit Mailversand und digitaler Annahme
Liste mit Nummer, Kunde, Summe, **Mail-Status**, Gültig bis, Marge. Status: Entwurf · gesendet · geöffnet · still (X Tage) · angenommen · verloren.

Detailpanel: Kennzahlen, Ereignis-Timeline (erzeugt → zugestellt → geöffnet Nx mit Zeitstempel → PDF geladen → Annahme-Link geklickt → digital angenommen mit Name/IP/Zeit), Mailvorschau mit den Buttons „Angebot annehmen" und „Rückfrage stellen", Aktionen „Erinnerung senden", „PDF ansehen", „In Auftrag wandeln".

**Technischer Ablauf bei Angebotserstellung (aus Step-Planer):**
1. Planung importieren → Positionen erzeugen (Modulanzahl, Wechselrichter, Speicher, Unterkonstruktion, Kabelwege), Vorschau-Diff „12 Positionen erkannt, 2 nicht zuordenbar"
2. Canvas-Snapshot der Planung (Satellitenbild + Dachpolygon + Module), 800×800 JPEG
3. PDF generieren (A4, Firmenlayout, Snapshot, Anlagendaten, nächste Schritte; **keine Preise im technischen Datenblatt-Teil**)
4. Zwei Mails versenden (Kunde: Bestätigung + PDF + Share-Link + Annahme-Button; Team: Notification + PDF + Adminlink + Kundendaten)
5. Ereignisse in `quote_event` protokollieren, Öffnungs-Pixel und Link-Tracking auswerten
6. Bei Annahme: `quote.status = accepted`, Auftrag automatisch anlegen, Bestätigungsmail, Aufgabe „Termin fixieren" für Bauleitung
7. Automatische Erinnerung nach 7 Tagen ohne Reaktion (abschaltbar)

Share-Link `?share={token}` öffnet die Planung read-only ohne Login.

### 4.5 CRM
Zwei Ansichten: **Liste** (Kunden/Leads/Aufgaben mit Detailpanel: Kontakt, Kennzahlen, Aktivitäten, Anlagen, offene Posten) und **Pipeline** (Board), umschaltbar zwischen drei CRM-Pipelines: Neukunden, Bestandskunden (Ausbau Speicher/Wallbox), Service-Verträge (Verlängerung).

Aktivitäten laufen automatisch ein: Portal-Ereignisse, Mailöffnungen, Anrufe, Angebotsstatus, Step-Planer-Leads.

### 4.6 Lager
Tabs: **Bestand** (Bestandsbalken gegen Mindestbestand, reserviert, verfügbar, Lagerort, EK) · **Artikel** (Stammdaten, Kennzahlen inkl. Ø Verbrauch und Lagerwert, Lieferantenpreise mit Lieferzeit, Reservierungen je Auftrag) · **Bewegungen** (Entnahme, Rückgabe, Wareneingang, Korrektur mit Auftrag, Person, Zeitstempel) · **Bestellungen** (Lieferant, Positionen, Liefertermin, Status + **Bestellvorschlag aus Bedarf** terminierter Aufträge und Mindestbestände, direkt an Lieferant sendbar).

Warnkarte oben: „3 Artikel unter Mindestbestand — 3× SYMO-GEN24-10 fehlen für A-2026-0419".

### 4.7 Einsatzplanung
Wochenraster: Zeilen Teams/Monteure, Spalten Mo–So mit Datum und Tagesauslastung. Blöcke per Drag & Drop verschieben und in Dauer ziehen. Overlays: Urlaub, Krankenstand, Berufsschule, Feiertag (schraffiert). Pool „nicht terminiert" rechts, Aufträge und Service-Tickets von dort in den Plan ziehbar.

Konfliktprüfung live mit Klartext-Warnband: Doppelbelegung, Ruhezeit < 11 h („Ruhezeit 9:15 h — Grenzwert 11:00 h"), fehlende Qualifikation, Wochenstunden über Soll. Rechts Wochenstunden je Person gegen Soll.

Aktionen: Woche kopieren, Plan veröffentlichen (Vorschau „7 Mitarbeiter werden benachrichtigt"), Export PDF/Excel.

### 4.8 Zeiterfassung Büro
Live-Leiste: „6 eingestempelt · 2 Pause · 1 Dienstgang" mit Avataren. Tagesansicht mit Mitarbeiter, Kommt, Pause, Ist, Soll, Differenz, Auftrag, Status. Problemzeilen farblich markiert und inline korrigierbar. Rechts Panel „Offene Korrekturanträge" mit Genehmigen/Ablehnen und Pflichtkommentar.

Plausibilitätsprüfung: > 10 h ohne Pause, Fahrtzeit unrealistisch zur Distanz, Buchung ohne Auftragszuordnung.

### 4.9 Stundenkonto
Pro Person: Ist, Soll, Saldo, Überstunden, Minusstunden, Übertrag Vorjahr, ausbezahlt, Zeitausgleich konsumiert. Saldoverlauf 12 Monate mit betonter Nulllinie, Buchungshistorie mit Filter. Aktionen: Zeitausgleich beantragen, Überstunden auszahlen, Korrektur mit Pflichtbegründung.

### 4.10 Rechnungen
KPIs: offen, überfällig, bezahlt im Monat, nächster Zahlungslauf. Liste mit Betrag, Fälligkeit, Teilrechnungsfortschritt, Status, Mahnstufe. Rechts: Mahnlauf-Vorschlag (Erinnerung, Mahnstufe 1, Mahnstufe 2) mit Sammelversand und Teilrechnungsdetail (Anzahlung, Teilrechnung Montage, Schlussrechnung nach Abnahme).

### 4.11 Abwesenheiten
Jahresplaner als Heatmap-Raster (Zeilen Mitarbeiter, Spalten Kalenderwochen), Urlaub/Krank/Schule farbcodiert, Resturlaub je Person. Rechts: offene Anträge mit Überschneidungswarnung und Besetzung je Woche gegen Mindestbesetzung (4 Monteure).

### 4.12 Mitarbeiter
Liste mit Foto, Position, Wochenstunden, Urlaubssaldo, Standort, Live-Status. Detail: Stammdaten, Arbeitszeitmodell, Qualifikationen mit Ablaufwarnung, Zeitkonto, Urlaub, Dokumente, Berechtigungen.

### 4.13 Dokumente
Ordnerstruktur (Lohnzettel, Dienstverträge, Zertifikate, Sicherheitsunterweisung, Aufträge, Vorlagen). Sammelupload mit automatischer Zuordnung („9 PDF erkannt, 9 Personen zugeordnet"), E-Signatur-Status je Dokument, Freigabe und Versand in einem Schritt.

### 4.14 Chat
Dreispaltig: Kanäle (Team, Baustelle je Auftrag, Bauleitung, Lager, Alle), Verlauf, Kontextpanel mit Auftrag und Mitgliedern. Systemnachrichten visuell abgesetzt (Materialentnahme, Dienstplanänderung, Angebotsannahme).

### 4.15 Bewerber
Kanban über 7 Phasen: Neu · Sichtung · Telefonat · Gespräch · Probearbeit · Zusage · Abgelehnt. Karte mit Foto, Position, Bewertung, nächstem Termin.

### 4.16 Berichte
Berichtsbibliothek als Kachelraster (Nachkalkulation, Auslastung, Zeitkonten, Lagerbewertung, Umsatz/Marge, Service, Vertrieb, Fehlzeiten) mit Zeitplan je Bericht. Darunter Berichtsansicht mit Filterleiste, Tabelle/Charts, Exportzeile (Excel, PDF). Nachkalkulation zeigt Abweichungsgrund je Auftrag.

### 4.17 Einstellungen
Rollen-Rechte-Matrix (Dreizustand, klickbar), Standorte mit Feiertagskalender und Arbeitszeitregeln, Arbeitszeitmodelle, Nummernkreise, Integrationen (Step-Planer, Outlook-Kalender, Mailversand, Buchhaltungsexport) als Schalter, Firmenlayout für PDFs.

---

## 5. Kundenportal

Zugang über personalisierten Link aus der Mail, optional PIN. Screens:

1. **Fortschritt** — 6 Phasen als Fortschrittsleiste mit Datum, Baustellen-Updates als Timeline (Klartext, keine internen Kürzel), nächster Termin mit „Termin bestätigen" / „Verschieben", Anlagendaten
2. **Ihr Angebot** — Positionen, Gesamt netto, **„Angebot verbindlich annehmen"** (erzeugt `accepted`-Event mit Name, Zeit, IP), Rückfrage stellen, PDF, Planungsvorschau, „Was nach der Annahme passiert"
3. **Dokumente und Bilder** — Unterlagen mit Status, Drag-and-drop-Upload für Kundenfotos (Zählerkasten, Dachboden, Kabelweg)
4. **Anliegen** — Kategorie wählen (Störung, Frage, Beschwerde, Rechnung), Beschreibung, Foto anhängen, Absenden → erzeugt `service_ticket`; darunter eigene Tickets mit Status und Antwort des Betriebs, direkte Kontaktliste
5. **Ertrag** — Monatsprognose, Ersparnis im ersten Jahr, Status Förderung und Netzanmeldung

Jede Kundenaktion erzeugt eine Aktivität im CRM und eine Benachrichtigung im Betrieb.

---

## 6. Mitarbeiter-Apps

### 6.1 Handy (Monteur, 390px, Handschuhbedienung, Touchziel ≥ 56px)
1. **Heute** — Begrüßung, aktueller Auftrag als Akzentkarte mit Navigation und Anruf, laufende Zeit als große Mono-Uhr, weitere Termine
2. **Stempeln** — Ringuhr mit Fortschritt gegen Auftragssoll, dominanter Ein-/Ausstempeln-Button, Nebenaktionen Pause, Dienstgang, Fahrtzeit, Auftrag wechselbar
3. **Material** — Barcode-Scanfläche, erkannter Artikel, „heute entnommen" mit Mengenschritten, „Zurück ins Lager", Sammelbuchung auf den Auftrag
4. **Auftrag mobil** — Adresse, Anrufen/Route, Checkliste antippbar, Fotoupload aus der Kamera, Notiz an das Büro
5. **Abwesenheit und Monatsbericht** — Kalenderauswahl, Art, Vertretung, Absenden; Monatsstunden mit Signaturfeld und Bestätigung
6. **Offline** — Banner „Offline — 3 Buchungen werden nachgesendet", Zeit läuft lokal weiter, Warteschlange mit Typ und Zeitstempel

Bottom-Nav 5 Punkte, „Stempeln" mittig hervorgehoben.

### 6.2 Desktop-Selfservice (für Büro-, Lager- und Bauleitungspersonal)
- **Heute** — eigene Tageszeit als Akzentkarte, Woche/Überstunden/Urlaub, meine Aufträge mit Fortschritt, heutige Buchungen, Team im Einsatz
- **Meine Zeiten** — alle Buchungen KW mit Auftrag, Zeitart, Status; Zeiten inline korrigierbar; Korrekturantrag mit Begründung an die Bauleitung; Zeitkonto-Kennzahlen; Zeitausgleich beantragen
- **Dokumente und Abwesenheit** — eigene Lohnzettel und Verträge mit E-Signatur-Status, eigene Abwesenheiten, Qualifikationen mit Ablaufdatum

---

## 7. Automatisierungen und Benachrichtigungen

| Auslöser | Aktion |
|---|---|
| Angebot 7 Tage ohne Reaktion | Erinnerungsmail + Aufgabe für Vertrieb |
| Angebot angenommen | Auftrag anlegen, Materialbedarf reservieren, Aufgabe „Termin fixieren" |
| Material unter Mindestbestand | Warnkarte Cockpit + Lager, Bestellvorschlag |
| Terminierter Auftrag ohne vollständiges Material | rote Karte in Pipeline, Blockade der Freigabe |
| Ruhezeit oder Wochenstunden verletzt | Warnband in Dispo, Veröffentlichung nur mit Bestätigung |
| Zertifikat läuft in 120 Tagen ab | Warnung Cockpit + Mitarbeiterprofil |
| Rechnung über Zahlungsziel | Mahnstufe erhöhen, Mahnlauf-Vorschlag |
| Dienstplan veröffentlicht | Push an betroffene Mitarbeiter + Systemnachricht im Chat |
| Kunde reicht Anliegen ein | Service-Ticket, Zuweisung nach Kategorie, Benachrichtigung |
| Monatsende | Stundenbericht je Mitarbeiter zur Signatur |

Alle destruktiven Aktionen mit Undo-Toast (8 s). Command-Palette (⌘K) auf jedem Screen mit Sprung zu Auftrag, Person, Artikel und ausführbaren Aktionen.

---

## 8. Integrationen

- **Step-Planer** — Planungsimport (Module, Wechselrichter, Speicher, Unterkonstruktion, Kabelwege, Ertrag, CO₂), Canvas-Snapshot, Share-Link
- **Mailversand** — transaktionaler Versand mit Öffnungs- und Klick-Tracking, PDF-Anhang, Absender `office@`-Domain des Betriebs
- **Outlook / Microsoft 365** — Kalendersync je Auftrag und Mitarbeiter, Zwei-Wege mit Konfliktkennzeichnung
- **Buchhaltung** — Rechnungsexport (BMD/DATEV-kompatibel), nächtlicher Lauf
- **Netzbetreiber und Förderstellen** — Statusfelder und Fristen, kein API-Zwang: Dokumentenupload plus Wiedervorlage
- **Lieferanten** — Bestellversand per Mail/CSV, optional API für Verfügbarkeit und Preise

---

## 9. Designsystem (aus den Mockups übernehmen)

**Farben (Light):** App `#EAE6E0`, Panel `#F8F6F3`, Surface `#FFFFFF`, Sunk `#F2EEE9`, Linie `#EAE4DC`, Text `#151210` / `#6A625A` / `#9C9289`, Akzent `#E8952B` mit Verlauf `#F2A73F → #C97918`.
**Dark:** App `#0C0B0A`, Panel `#151211`, Surface `#1D1917`, Sunk `#221E1B`, Linie `#2A2522`, Text `#F2EEE9` / `#A79E95` / `#7A726A`.

**Statusfarben:** Neu/Entwurf `#8B92A0`, In Arbeit `#3E7BC6`, Wartet auf Kunde `#8465C4`, Erledigt `#3E9E6B`, Achtung `#E8952B`, Kritisch `#D2543F`. Status immer als Pill mit Fläche **und** Text, nie nur Farbe.

**Typografie:** Inter Tight für UI (13px Tabellen, 14px Fließtext, 15–17px Kartentitel, 29–32px Seitentitel, `letter-spacing: -0.03em` bei großen Titeln). JetBrains Mono mit `tabular-nums` für alle Zahlen, Zeiten, IDs, Beträge, Artikelnummern.

**Form:** schwebende Panels Radius 26px, Karten 18–20px, Pills und Buttons 99px, Inputs 14px. Schatten weich und flach: `0 1px 2px rgba(21,18,16,.04), 0 8px 24px rgba(21,18,16,.04)`. Sidebar 246px. Content max 1680px. Tabellenzeile 44px, Kompaktmodus 36px.

**Charts:** Balken als Pills mit runden Kappen, inaktive Werte schraffiert oder als Akzent-Tint, Ringe über `conic-gradient`, Kapazitätslinie gestrichelt. Keine dekorativen Diagramme.

**Icons:** einheitliches Linienset, 1,8px Strichstärke, `currentColor`, 15–18px, geometrisch reduziert.

**Bewegung:** 160–220ms `cubic-bezier(.2,0,0,1)`. Drag hebt 4px mit 3° Neigung. Zahlen zählen hoch. Skeletons statt Spinner. Kein Parallax, keine Deko-Animation.

**Nicht bauen:** leere States als Hauptdarstellung, Chatbot-Sidebar, Karussells, Hero-Illustrationen, Emoji als Icons, Modals für Dinge die inline gehen, mehr als drei Akzentelemente pro Screen.

---

## 10. Technische Empfehlungen

- Web-App als SPA (React + TypeScript), serverseitige Filter und Pagination für Tabellen, optimistische Updates bei Inline-Edits
- Handy-App als PWA mit ServiceWorker-Queue und IndexedDB-Puffer; Zeitstempel immer clientseitig erfasst und serverseitig validiert
- Zeitzonen und Sommerzeit: alles in UTC speichern, Anzeige in `Europe/Vienna`
- Arbeitsrechtliche Prüfungen (Ruhezeit 11 h, Höchstarbeitszeit, Pausenpflicht) als Regelmodul, pro Standort konfigurierbar
- Revisionssicherheit: `audit_log` append-only, Zeitkorrekturen niemals überschreibend
- Berechtigungen serverseitig durchsetzen, nicht nur im UI ausblenden
- Seed-Datensatz aus den Mockups für Demo und E2E-Tests verwenden

---

## 11. Reihenfolge der Umsetzung

1. Auftrag, Kunde, Artikel, Zeiterfassung, Materialbuchung (Fundament, ohne das nichts funktioniert)
2. Pipelines mit Board/Tabelle, Auftragsdetail
3. Angebote inkl. Step-Planer-Import, PDF, Mailversand mit Annahme
4. Lager mit Bewegungen, Bestellungen, Bestellvorschlag
5. Monteur-Handy-App inkl. Offline-Queue
6. Einsatzplanung mit Konfliktprüfung
7. Rechnungen, Mahnlauf
8. Kundenportal
9. CRM-Pipelines, Service-Tickets
10. Personal: Abwesenheiten, Stundenkonto, Dokumente, Mitarbeiter-Desktop
11. Chat, Bewerber, Berichte, Einstellungen
