# BRIEFING: Navigation & Zeiterfassung — Neuschnitt — Solstep Betrieb

Viertes Modul-Briefing, Version 2. Setzt voraus:
BRIEFING-vorgang-pipeline.md, BRIEFING-einsatzplanung.md,
BRIEFING-material.md. Dieses Briefing ERSETZT die bestehende Navigation
und alle bestehenden Zeit-Seiten (Stempeln, Meine Zeiten, Stundenkonto,
Zeiterfassung, Korrekturanträge). Es baut nichts daneben — es räumt auf.

Anlass: Der aktuelle Stand hat für alle Rollen dieselbe überladene
Navigation (15+ Punkte), vier getrennte Zeit-Seiten, zwei
Dokumente-Seiten und widersprüchliche Anzeigen (Live-Status „niemand
eingestempelt" neben einer Tabelle mit Kommt-Zeiten; Buchungen
18:02–18:02 mit Dauer 0:00; Zeiten ohne Einsatzbezug). Ursache: mehrere
parallele Datenwege und keine Rollentrennung.

---

## 1. Kernentscheidung: Zwei Apps, eine Codebasis

Nach dem Login entscheidet die Rolle, welche App gerendert wird. Keine
gemischte Navigation mehr.

### 1.1 Mitarbeiter-App (Rollen monteur, lager) — mobile-first

Genau VIER Navigationspunkte, mehr existiert für diese Rollen nicht:

1. **Heute** — der Startscreen, ersetzt „Mein Einsatz" UND „Stempeln":
   - Einsatzkarte(n) heute: Art, Zeitraum, Adresse (Navi-Link),
     Kundenkontakt, Team, Beladeliste/Materialliste (aus
     Material-Briefing), erwartete Baustellenlieferungen.
   - **Der Stempel-Button sitzt AUF der Einsatzkarte.** „Zeit starten"
     am Einsatz — nicht auf einer eigenen Seite, nicht kontextlos.
     Läuft eine Zeit, zeigt die Karte den laufenden Zähler und
     „Zeit stoppen" (→ Verbrauchsmeldung, siehe Material-Briefing).
   - Kein Einsatz geplant, trotzdem Arbeit? Button „Zeit ohne Einsatz
     starten" → erzwingt die Wahl: bestehenden Einsatz suchen ODER
     Art intern mit Kurzgrund. Es entsteht dabei IMMER ein Einsatz —
     eine Zeit ohne Einsatzbezug kann im System nicht existieren.
   - Darunter kompakt: kommende Einsätze (7 Tage).
2. **Meine Zeiten** — Liste eigener Zeiten (Woche/Monat), Status
   sichtbar (gebucht/genehmigt/korrigiert), eigener Saldo und
   Resturlaub als zwei Kennzahlen oben. Korrektur BEANTRAGEN (mit
   Begründung) statt selbst ändern. Ersetzt „Meine Zeiten" +
   „Stundenkonto"-Sicht des Mitarbeiters.
3. **Abwesenheiten** — eigener Resturlaub, eigene Einträge, Jahresblick
   nur die eigene Zeile. (Eintragen weiterhin nur Büro/GF laut
   Planungs-Briefing — hier nur ansehen.)
4. **Meine Dokumente** — Lohnzettel, Verträge, Nachweise. Nur eigene.

Kein Board, keine Plantafel anderer, keine Beträge, kein Lager-Modul
für monteur (lager bekommt zusätzlich den Punkt **Lager** aus dem
Material-Briefing — dann fünf Punkte).

### 1.2 Betriebs-App (Rollen gf, buero, bauleitung)

Navigation, neun Punkte:

1. **Cockpit** — Startseite nach Login. Bestehendes Cockpit
   beibehalten, Inhalt in dieser Stufe nicht umbauen. Bedingung: alle
   Kacheln zeigen mit den Seed-Daten plausible Werte — keine leeren
   Charts, keine Null-Kacheln, keine Widersprüche zu anderen Ansichten
   (gleiche Datenquellen wie Board und Zeiten-Modul).
2. **Vorgänge** (Board + Detail, aus Pipeline-Briefing)
3. **Planung** (Plantafel, aus Planungs-Briefing)
4. **Material** (Bedarf/Bestellungen/Lager-Übersicht, aus
   Material-Briefing)
5. **Zeiten** — DAS eine Zeit-Modul (Abschnitt 2)
6. **Abwesenheiten** (Jahresplaner alle Personen, Eintragen,
   Besetzungsübersicht)
7. **Rechnungen & OP** (aus Pipeline-Briefing; für bauleitung
   ausgeblendet)
8. **Mitarbeiter** (Stammdaten, Arbeitszeitmodell, Qualifikationen,
   Personalakte-Dokumente)
9. **Einstellungen** (nur gf)

Persönliches (eigene Zeiten stempeln, eigene Dokumente) für gf/buero/
bauleitung: über das Profilmenü oben rechts erreichbar („Mein Bereich",
rendert dieselben Komponenten wie die Mitarbeiter-App). Es steht NICHT
in der Hauptnavigation.

### 1.3 Gestrichene Module

**Chat und Bewerber werden ersatzlos entfernt** (Code, Routen,
Navigation, Tabellen nach Datensicherung). Beides ist HR-Suite-Scope,
der im Pipeline-Briefing explizit ausgeschlossen wurde. **Berichte**
wird aus der Navigation entfernt, bis es echte Berichte gibt (leere
Hülsen erzeugen Misstrauen); das Thema kommt nach der Demo als eigener
Auftrag. **Service** als eigener Punkt entfällt — Service-Einsätze
leben in Planung und Vorgängen (Planungs-Briefing). Die eigenständigen
Seiten Stempeln und Stundenkonto entfallen — ihre Funktionen sind in
„Heute" (Stempeln am Einsatz) bzw. „Meine Zeiten"/Zeiten-Tab „Konten"
aufgegangen.

---

## 2. Zeiterfassung — ein System statt vier Seiten

### 2.1 Eine Wahrheit

Es gibt genau EINE Zeiten-Quelle (die Zeiten am Einsatz aus dem
Planungs-Briefing). Alles andere sind Sichten darauf:

- Live-Anwesenheit = Zeiten mit offenem Ende, JETZT. Es darf
  unmöglich sein, dass „niemand eingestempelt" neben einer Zeile mit
  Kommt-Zeit steht — beide Anzeigen lesen dieselbe Abfrage.
- Tages-/Wochenansicht = abgeschlossene + laufende Zeiten.
- Stundenkonto/Saldo = ABGELEITET: Ist (genehmigte Zeiten) minus Soll
  (Arbeitszeitmodell des Mitarbeiters, Feiertage AT/DE je Tenant,
  Abwesenheiten zählen je Typ als Soll-Erfüllung). KEINE manuellen
  Konto-Bewegungen. Wenn der Saldo falsch ist, wird die Ursache
  korrigiert (Zeit oder Modell), nie das Ergebnis.

### 2.2 Zwei Wege, wie Zeit entsteht — keine weiteren

1. **Stempeln am Einsatz** (Mitarbeiter-App, Regelfall).
2. **Nacherfassung durch Büro/GF** im Zeiten-Modul: Person, Einsatz
   (Pflicht — Suche nach Einsätzen des Tages, sonst intern mit Grund),
   von/bis. Für vergessenes Stempeln.

Der bisherige freie Dialog „Buchung anlegen" mit Person/Art/Beginn/Ende
ohne Einsatzbezug entfällt. Eine „Art" wird nie von Hand gewählt — sie
kommt immer vom Einsatz.

### 2.3 Korrekturen

Bestehendes Prinzip beibehalten (ist richtig): Zeiten werden nie
überschrieben, eine Korrektur ersetzt und das Original bleibt sichtbar.
Vereinheitlichen:

- Mitarbeiter beantragt Korrektur mit Begründung (aus „Meine Zeiten").
- Büro/GF genehmigt/lehnt ab im Zeiten-Modul (Badge mit Anzahl offener
  Anträge) oder korrigiert direkt (quelle=korrektur, ohne Antrag).
- Begründung ist Pflicht bei jeder Korrektur, egal von wem.

### 2.4 Validierung — die Fehlerquellen aus dem Ist-Stand schließen

- **Null- und Mini-Buchungen:** Ende ≤ Beginn wird abgelehnt. Dauer
  < 5 min beim Stoppen → Rückfrage „Verwerfen oder speichern?"
  (verhindert 18:02–18:02-Einträge durch Doppeltipp).
- **Doppelstempeln:** pro Person maximal EINE laufende Zeit. Start bei
  laufender Zeit → Hinweis mit Stopp-Option, kein zweiter Start.
- **Überlappung:** Nacherfassung/Korrektur, die eine bestehende Zeit
  überlappt → blockiert mit Anzeige der Kollision.
- **Mitternacht/12 h:** Auto-Stopp + „zu prüfen" (aus Planungs-Briefing,
  hier die Prüfliste im Zeiten-Modul).
- **Zukunft:** Beginn in der Zukunft nur für Büro/GF (geplante
  Nacherfassung), nie beim Stempeln.
- Alle Prüfungen serverseitig, nicht nur im Formular.

### 2.5 Das Zeiten-Modul der Betriebs-App (eine Seite, drei Tabs)

1. **Heute** — Live: wer ist gerade eingestempelt (auf welchem
   Einsatz), Tagesliste aller Personen mit Ist/Soll/Diff, Auffälligkeiten
   („zu prüfen"). Kennzahlenkarten oben: NUR Teamwerte (eingestempelt
   jetzt, Ist heute gesamt, zu prüfen, offene Korrekturen). Keine
   Vermischung mit persönlichen Werten des eingeloggten Users.
2. **Woche** — Wochenraster Person × Tag, Wochensummen,
   **Wochenabschluss**: Büro/GF genehmigt die Woche pro Person (Status
   aller Zeiten → genehmigt). Erst genehmigte Zeiten zählen in den
   Saldo. Sammelaktion „ganze Woche genehmigen" wenn keine
   Auffälligkeiten.
3. **Konten** — Saldoverlauf pro Person (Ist gegen Soll je Monat),
   Resturlaub, offene Korrekturanträge. Reine Auswertung, keine
   Eingaben außer Korrektur-Entscheidungen.

### 2.6 Sprache im UI

Alle Texte in der Sprache des Betriebs, nicht der Entwicklung.
Formulierungen wie „Die Dauer rechnet die Datenbank aus Beginn und
Ende" oder „Durchgesetzt wird das in der Datenbank, nicht hier" sind
Implementierungsnotizen und werden entfernt. Erklärtexte maximal ein
Satz, ohne Technik-Vokabular (Datenbank, RLS, Rolle-ID). Kein Gendern,
Du-Form durchgängig.

---

## 3. Aufräumarbeiten (verbindlich)

1. Routen /stempeln, /meine-zeiten, /stundenkonto, /zeiterfassung,
   /meine-dokumente, /dokumente, /chat, /bewerber, /service,
   /berichte entfernen bzw. auf die neuen Ziele umleiten.
2. Alt-Zeiten ohne Einsatzbezug migrieren: je Person/Tag einem
   passenden Einsatz zuordnen, sonst Sammel-Einsatz art=intern
   „Migration Altdaten" pro Person/Tag. Danach Konsistenz-Check:
   keine Zeit ohne Einsatz.
3. Dokumente: EIN Dokumente-Konzept — Vorgangs-Dokumente leben im
   Vorgang (Pipeline-Briefing), Personal-Dokumente unter Mitarbeiter
   bzw. „Meine Dokumente". Die getrennten Seiten „Dokumente" (global)
   und deren Kennzahlen-Karten entfallen.
4. Demo-Daten säubern: keine 0:00-Buchungen, keine Zeiten ohne
   Einsatz, Saldoverlauf mit plausiblen 12 Monaten befüllen, damit
   das Chart im Demo-Tenant nicht leer wirkt. Cockpit-Kacheln mit
   denselben Seed-Daten plausibel gefüllt.

---

## 4. Abnahmetests

1. Login monteur → Mitarbeiter-App mit genau 4 Punkten (lager: 5).
   Kein Board, keine Plantafel, keine Beträge in irgendeiner Response
   (API prüfen, nicht nur UI).
2. Login gf → Betriebs-App mit 9 Punkten, Startseite Cockpit, alle
   Cockpit-Kacheln zeigen Werte ≠ leer; kein „Mein Einsatz"/
   „Stempeln"/„Meine Zeiten" in der Hauptnavigation; „Mein Bereich"
   über Profilmenü funktioniert. Login bauleitung → ohne Rechnungen
   & OP und ohne Einstellungen.
3. Monteur stempelt auf Einsatzkarte → Zeit läuft am Einsatz; Zeiten-
   Modul Tab Heute zeigt ihn SOFORT als eingestempelt inkl. Einsatz.
   Live-Kachel und Tagesliste widersprechen sich in keinem Zustand.
4. „Zeit ohne Einsatz starten" → erzwungene Wahl, es entsteht ein
   Einsatz; Abfrage auf Zeiten ohne Einsatz liefert IMMER null Zeilen.
5. Doppeltipp Start/Stopp binnen Sekunden → Rückfrage, keine
   0:00-Buchung in der Datenbank.
6. Zweiter Start bei laufender Zeit → abgelehnt mit Stopp-Option.
7. Nacherfassung mit Überlappung → serverseitig blockiert (API-Test).
8. Korrekturantrag Monteur → Badge im Zeiten-Modul, Genehmigung →
   Original bleibt als „ersetzt" sichtbar, Saldo ändert sich erst mit
   Genehmigung.
9. Wochenabschluss: Woche genehmigen → alle Zeiten der Person
   genehmigt, Saldo aktualisiert; ungenehmigte Zeiten zählen nicht.
10. Saldo-Herleitung: Arbeitszeitmodell 38,5 h, ein Feiertag (AT),
    ein Urlaubstag → Soll korrekt reduziert, Saldo nachrechenbar.
11. Routen /chat und /bewerber existieren nicht mehr (404 bzw.
    Redirect), Navigation zeigt sie nirgends; /berichte ebenso.
12. Kein UI-Text enthält „Datenbank", „RLS" oder Rollen-Interna
    (String-Suche über die Oberflächentexte).
13. Tenant-Isolation unverändert grün auf allen Zeit-Tabellen.

---

## 5. Vorgehen

1. Rollen-Routing + zwei App-Shells (Navigation, Layouts; Cockpit als
   Startseite der Betriebs-App)
2. Mitarbeiter-App „Heute" mit Stempeln am Einsatz (wichtigster Screen
   des ganzen Produkts)
3. Zeiten-Modul Betriebs-App, Tab „Heute" (Live + Tagesliste aus
   derselben Datenquelle)
4. Seed-Daten an neue Struktur anpassen (inkl. Cockpit-Kacheln)
5. Zeiten-Modul Tabs „Woche" und „Konten" inkl. Wochenabschluss und
   Saldo-Herleitung
6. Korrektur-Flow + serverseitige Validierungen
7. Aufräumarbeiten (Routen, UI-Texte, Dokumente-Konsolidierung);
   Migration Alt-Zeiten als allerletzter Schritt, nur wenn alles
   andere grün

Design: bestehendes CI beibehalten. Mitarbeiter-App konsequent
mobile-first mit großen Touch-Zielen (Stempel-Button min. 56 px Höhe),
Betriebs-App desktop-first.
