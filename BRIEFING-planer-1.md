# BRIEFING: Solstep Planer — PV-Planungstool (technische Umsetzung)

Fünftes Modul-Briefing. Setzt voraus: BRIEFING-vorgang-pipeline.md
(Vorgang, Bedarfsliste, Artikelstamm) und BRIEFING-material.md
(Artikel-Typen, Paket-Stücklisten). Die Datei **Planer-HTML.html**
(im Projektordner, interaktiver Prototyp) ist die verbindliche UX-
und CI-Referenz für Layout, Phasen-Stepper, Panel und KPI-Leiste —
vor Beginn öffnen und durchklicken. Dieses Briefing definiert die
echte Funktionalität dahinter. Stack: Next.js 15, Supabase, Vercel.
Schema-Details entscheidet Claude Code; verbindlich sind die
fachlichen Regeln und Formeln in diesem Dokument.

Anspruch: Reonic-Klasse. In unter 10 Minuten von der Adresse zur
elektrisch geprüften Anlage mit Wirtschaftlichkeit und Kunden-PDF,
live beim Endkunden am iPad. Alles muss FUNKTIONIEREN, nicht nur
aussehen — jede Zahl nachrechenbar, jede Prüfung mit Testvektor.

---

## 1. Kernentscheidungen (nicht verhandelbar)

1. **Alles wird in Metern gerechnet, nie in Pixeln.** Beim Anlegen
   eines Projekts wird ein lokales metrisches Koordinatensystem um den
   Projektmittelpunkt aufgespannt (WGS84 → lokale Tangentialebene;
   Meter/Grad über Breitengrad). Alle Geometrien (Dachflächen,
   Hindernisse, Modulgruppen, Module) werden in diesem System in
   Metern gespeichert. Pixel entstehen nur beim Rendern aus Zoomstufe.
   Konsequenz: Kartenanbieter wechseln, Zoomen, Fenstergröße — nichts
   davon verändert je eine gespeicherte Geometrie.
2. **Draufsicht-Planung mit Verkürzung.** Geplant wird in der
   Draufsicht (wie das Luftbild). Ein Modul der wahren Größe
   B × H liegt auf einer geneigten Fläche in der Draufsicht verkürzt:
   die Kante in Falllinienrichtung erscheint als H × cos(Neigung),
   die Kante parallel zur Traufe unverkürzt. Gespeichert werden wahre
   Maße + Flächenzuordnung; die Verkürzung ist reine Renderlogik.
   Flächen, Stückzahlen, Strings rechnen immer mit wahren Maßen.
   (Das ist die häufigste Fehlerquelle — Tests in Abschnitt 12.)
3. **Der Canvas ist eine eigene Rendering-Schicht** (SVG oder
   Canvas2D, Entscheidung frei; Anforderungen: 60fps Pan/Zoom am iPad
   mit 200+ Modulen, Pinch-Zoom, Zwei-Finger-Pan, Ein-Finger
   zeichnet/zieht). Kein Map-SDK als Zeichenfläche — die Karte ist
   nur ein Bild-Layer darunter (Abschnitt 2).
4. **Undo/Redo über alles** (Zeichnen, Belegung, Gruppen, Strings)
   als Command-Stack, min. 50 Schritte. Autosave debounced, niemals
   ein Speichern-Button.

---

## 2. Karten-Layer & Drohnenfoto

### 2.1 Anbieter

Vier umschaltbare Bildquellen, Segmented Control wie im Prototyp:

| Anbieter | Quelle | Hinweis |
|---|---|---|
| Google | Map Tiles API (Satellite) | API-Key im Tenant hinterlegbar |
| Apple | MapKit JS (Satellite) | Token serverseitig erzeugt |
| Bing/Azure | Azure Maps Satellite Tiles | Key im Tenant |
| Basemap (AT) | basemap.at Orthofoto WMTS | frei, beste Auflösung in AT, kein Key |

- Alle vier liefern Web-Mercator-Kacheln → eine gemeinsame
  Tile-Engine (Zoom 18–21), Meter-pro-Pixel exakt aus Zoomstufe und
  Breitengrad. Beim Umschalten wechselt NUR der Bild-Layer; alle
  Geometrien bleiben exakt liegen (leichter Bildversatz zwischen
  Anbietern ist normal und gewollt sichtbar — so prüft der Nutzer
  Dachkanten gegen ein zweites Bild).
- Bilddatum des Anbieters anzeigen, wo die API es liefert.
- Fehlerzustand pro Anbieter (Kachel lädt nicht): Hinweis + die
  anderen Anbieter hervorheben, nie ein leerer Canvas.
- Keys fehlen → Anbieter im Umschalter ausgegraut mit Tooltip
  „In den Einstellungen hinterlegen". Basemap funktioniert immer.

### 2.2 Adresseinstieg

Adresssuche mit Autocomplete (Anbieter-agnostisch, z. B. über den
aktiven Karten-Anbieter oder Nominatim als Fallback), danach
animierter Zoom auf das Grundstück (Prototyp-Verhalten).

### 2.3 Drohnenfoto-Modus

- Foto-Upload ersetzt den Karten-Layer (Projekt merkt sich Modus).
- Kalibrierung als geführter Zwei-Schritt: Referenzstrecke am Bild
  ziehen → wahre Länge in m eingeben → Umrechnungsfaktor gespeichert,
  Badge „kalibriert" mit Faktor sichtbar. Re-Kalibrieren möglich,
  skaliert bestehende Geometrien mit (mit Bestätigungsdialog).
- Optional zweite Referenzstrecke quer zur ersten; weicht das
  Verhältnis > 3 % ab → Warnung „Foto ist verzerrt — möglichst
  senkrecht aufnehmen".
- Alles andere (Zeichnen, Belegung, …) identisch zum Kartenmodus.

---

## 3. Dachmodell — ALLE Dachformen

### 3.1 Grundprinzip

Ein Projekt hat 1–n **Dachflächen**. Eine Dachfläche ist ein
beliebiges einfaches Polygon (3–n Punkte, konvex oder konkav) mit:

- Neigung (0–75°), Azimut (0–359°, 180 = Süd), Bezeichnung
- Traufe-/Firstkante-Markierung (definiert die Falllinie; bei
  Flachdach entfällt sie)
- Randabstand (Default 0,30 m, pro Fläche einstellbar; definiert die
  belegbare Innenfläche)
- 0–n **Hindernisse**: Rechteck oder freies Polygon (Kamin, Fenster,
  SAT, Entlüfter, Gaube-Aussparung, freie Sperrfläche), jedes mit
  eigenem Abstandsrand (Default 0,30 m), gerendert als gestrichelte
  Pufferzone.

Damit ist JEDE Dachform abbildbar — es gibt keine Dachform, die das
Datenmodell nicht kann, weil die Fläche ein freies Polygon ist:

| Dachform | Abbildung |
|---|---|
| Satteldach | 2 Rechteck-Flächen, gegenläufiger Azimut |
| Pultdach | 1 Fläche |
| Walmdach | 2 Trapeze + 2 Dreiecke |
| Krüppelwalm | 2 Trapeze + 2 kleine Trapeze/Dreiecke |
| Zeltdach | 4 Dreiecke |
| Mansarddach | je Seite 2 Flächen mit unterschiedlicher Neigung |
| Flachdach | 1 Fläche, Neigung 0, Aufständerung (Abschnitt 4.4) |
| L-/T-/U-Haus, Gauben, Erker | beliebige Polygone + Aussparungen |

### 3.2 Zeichnen

- Polygon-Tool: Ecken tippen, Doppeltap/Enter schließt, Esc bricht ab.
  Kantenlängen live in m an jeder Kante (Pillen wie im Prototyp),
  nach dem Schließen editierbar: Eckpunkt ziehen, Kante ziehen
  (parallelverschieben), Punkt auf Kante einfügen (Doppeltap auf
  Kante), Punkt löschen.
- **Maßeingabe per Tastatur:** Kantenlänge antippen → Zahl eintippen
  → Kante wird exakt auf dieses Maß gesetzt (Nachbarpunkt wandert).
  Für den Fall „ich weiß, das Dach ist 12,40 m" — wichtiger als
  perfektes Luftbild.
- Snapping (abschaltbar, Toggle im Werkzeug): rechte Winkel (±4°),
  Parallelität zu bestehenden Kanten, 0,05-m-Raster.
- **Dachform-Assistent** (optional, beschleunigt Standardfälle):
  Auswahl Sattel/Walm/Pult/Zelt/Flach → legt die passenden Flächen
  als zusammenhängende, gemeinsam ziehbare Gruppe an, First/Traufe
  vorbelegt, danach frei editierbar wie handgezeichnet. Der Assistent
  erzeugt normale Flächen, keinen Sondermodus.
- Falllinie: aus der markierten Traufkante abgeleitet (senkrecht
  dazu, bergab), als dezenter Pfeil auf der Fläche visualisiert.
  Azimut wird daraus vorbelegt, bleibt manuell übersteuerbar.
- Messen-Tool: freie Strecke ziehen → Länge in m, verschwindet beim
  nächsten Werkzeugwechsel.

---

## 4. Modulbelegung — das Herzstück

### 4.1 Modulgruppen (zentrale Neuerung gegenüber dem Prototyp)

Module gehören immer zu einer **Modulgruppe**. Eine Dachfläche kann
beliebig viele Gruppen tragen. Jede Gruppe hat ihr EIGENES Raster:

- Modultyp (aus Stammdaten; Gruppen dürfen unterschiedliche Module
  haben, Warnhinweis bei Mischung im selben String)
- Ausrichtung Hoch-/Querformat
- Reihen- und Spaltenabstand (Default 0,02 m)
- Rasterwinkel: Default parallel zur Traufkante der Fläche; frei
  drehbar in 0,5°-Schritten (für schiefe Dächer/Sonderfälle)
- Ankerpunkt (Position des Rasters auf der Fläche)
- bei Flachdach zusätzlich: Aufständerung (4.4)

**Interaktionen mit Gruppen:**

- **Gruppe verschieben:** Gruppe antippen (Rahmen mit Griffen
  erscheint) → ziehen. Alle Module der Gruppe wandern mit, Kollisions-
  und Randprüfung läuft live (unplatzierbare Module werden während
  des Zugs rot-transparent, beim Loslassen entfernt-markiert, nicht
  gelöscht — kommen zurück, wenn wieder Platz ist).
- **Gruppe drehen:** Dreh-Griff am Rahmen, snappt auf traufparallel.
- **Gruppe erweitern:** Kantengriffe ziehen fügt Reihen/Spalten
  hinzu bzw. entfernt sie.
- **Neue Gruppe:** Werkzeug „Modulgruppe" → Rechteck auf der Fläche
  aufziehen → wird mit dem Gruppenraster gefüllt. Oder Button
  „Fläche automatisch belegen" → Auto-Belegung erzeugt EINE Gruppe
  als Startvorschlag (maximale Belegung, traufparallel) — danach
  normale Gruppe, teilbar und verschiebbar.
- **Gruppe teilen:** Auswahlrechteck über einen Teil der Gruppe →
  „Als eigene Gruppe abtrennen". So entstehen aus einem
  Auto-Vorschlag mehrere unabhängig verschiebbare Felder.
- Gruppenliste im Panel: je Gruppe Name (editierbar, Default
  „Feld 1/2/…"), Modulanzahl, kWp, Sichtbarkeits-Highlight beim
  Hover.

### 4.2 Einzelmodule

- **Tap:** Modul deaktivieren/aktivieren (ausgegraut gestrichelt,
  nicht gelöscht — Prototyp-Verhalten).
- **Ziehen (Long-Press am iPad / Drag mit Maus):** Modul verlässt
  sein Raster und wird FREI positionierbar. Es bleibt Mitglied
  seiner Gruppe (für Zählung/String), bekommt aber eine eigene
  Position. Beim Ziehen: Snapping auf das Gruppenraster (einrasten,
  wenn nahe einer Rasterzelle), auf Kanten benachbarter Module und
  auf die Randabstands-Linie; Snapping mit gedrücktem Alt /
  zweitem Finger temporär aus.
- Frei positionierte Module unterliegen denselben Kollisionsregeln
  wie alle: nie über Dachrand-Innenlinie, nie in Hindernispuffer,
  nie überlappend mit anderen Modulen (Kollision → Zug wird an der
  letzten gültigen Position gestoppt, rotes Aufblinken).
- Mehrfachauswahl per Auswahlrechteck: gemeinsam deaktivieren,
  verschieben, einer Gruppe/einem String zuordnen.
- Kontextaktion „ins Raster zurück": frei positioniertes Modul
  springt auf die nächste freie Rasterzelle seiner Gruppe.

### 4.3 Auto-Belegung (Startvorschlag, nie Zwang)

Algorithmus je Fläche: belegbare Innenfläche = Polygon minus
Randabstand (Polygon-Offset) minus Hindernispuffer. Raster
traufparallel ab Traufe, Zeilen von unten nach oben; Modul wird
platziert, wenn sein (in Draufsicht verkürztes) Rechteck vollständig
in der Innenfläche liegt. Ergebnis als eine Gruppe. Laufzeit < 300 ms
für 60 m²-Fläche. Bestehende Gruppen werden bei erneuter
Auto-Belegung NIE angefasst — sie belegt nur Restflächen (Rückfrage:
„Restfläche füllen oder alles neu?").

### 4.4 Flachdach

- Gruppen-Eigenschaft Aufständerung: Süd (ein Winkel) oder Ost-West
  (Paare), Aufständerungswinkel (Default Süd 15°, O/W 10°).
- Reihenabstand: automatisch vorgeschlagen aus Winkel + Modulhöhe
  gegen Winterverschattung (21.12., Sonnenhöhe am Standort;
  vereinfachte Formel d = h_modul · sin(β) / tan(α_sonne) — als
  Vorschlag mit Herleitungs-Tooltip), manuell übersteuerbar.
- Draufsicht-Verkürzung analog: cos(Aufständerungswinkel).
- Randabstand Flachdach Default 1,00 m (Windlast-Randzone), Hinweis
  bei Unterschreitung, kein Block (statiknahe Themen bleiben beim
  Betrieb).
- Ertragsberechnung nutzt Aufständerungswinkel + Gruppenazimut
  (O/W: beide Teilfelder getrennt an PVGIS).

---

## 5. Technik: Stammdaten, Strings, elektrische Prüfung

### 5.1 Stammdaten (pro Tenant, plus globaler Solstep-Katalog)

- **Modul:** Hersteller, Typ, Wp, Uoc, Umpp, Isc, Impp,
  Temp-Koeffizient Uoc (%/K), Maße, Gewicht, optional Bild/Datenblatt.
- **Wechselrichter:** max. DC-Spannung, MPPT-Anzahl, je MPPT
  MPP-Fenster (Umin–Umax), max. Strom je MPPT, max. Strings je MPPT,
  AC-Nennleistung, max. empfohlene DC-Leistung, Hybrid ja/nein,
  kompatible Speicher (Liste).
- **Speicher:** nutzbare kWh, Modulgrößen (erweiterbar in Schritten),
  kompatible WR.
- Pflege-UI unter Einstellungen; CSV-Import; Solstep-Katalog mit den
  ~50 gängigsten DACH-Geräten wird als Seed mitgeliefert und ist
  tenant-seitig nur referenzierbar, nicht editierbar (eigene Kopie
  anlegen möglich).

### 5.2 Strings

- String = geordnete Menge aktiver Module, einem MPPT zugeordnet.
  Zuordnung per „malen" (Prototyp) oder Mehrfachauswahl → „String X".
- Mehrere Strings je MPPT erlaubt bis max. Strings des WR (parallel;
  Prüfung: gleiche Modulanzahl je parallelem String, sonst Warnung).
- Module verschiedener Typen im selben String → Warnung (kein Block).
- Nicht zugeordnete aktive Module → Hinweis-Pill „X Module ohne
  String", blockiert „elektrisch geprüft".

### 5.3 Elektrische Prüfung — Formeln (verbindlich)

Auslegungstemperaturen: T_min = −10 °C, T_STC = 25 °C.

```
Uoc_kalt   = Uoc_STC · (1 + tk_uoc · (T_min − T_STC))     [tk_uoc negativ, z. B. −0,0025/K]
U_string   = n · Uoc_kalt                → muss ≤ WR.maxDC
Umpp_str   = n · Umpp_STC               → muss in [MPPT.Umin, MPPT.Umax]
I_mppt     = Σ Impp paralleler Strings  → muss ≤ MPPT.Imax
n_max      = floor(WR.maxDC / Uoc_kalt)
DC/AC      = Σ kWp / WR.AC_Nennleistung → Info-Anzeige, Warnung > 1,5
```

Jede Verletzung erzeugt GENAU EINEN Klartext-Satz mit Lösung im
Muster des Prototyps („21 Module: Leerlaufspannung 1.081 V
überschreitet die max. DC-Spannung 1.000 V — maximal 19 Module.").
Kein Fehlercode. Weiter zur Wirtschaftlichkeit geht mit Warnung,
das PDF trägt dann „elektrisch ungeprüft".

**Testvektoren (müssen als Unit-Tests exakt so bestehen):**

| Modul | n | WR maxDC | Uoc_kalt | U_string | Ergebnis |
|---|---|---|---|---|---|
| Uoc 39,4 V, tk −0,25 %/K | 19 | 1000 V | 42,85 V | 814,1 V | OK |
| dito | 24 | 1000 V | 42,85 V | 1028,3 V | FEHLER, n_max = 23 |
| Umpp 33,1 V, MPPT 200–800 V | 5 | — | — | Umpp 165,5 V | FEHLER „mehr Module" |
| dito | 21 | — | — | Umpp 695,1 V | OK |

### 5.4 Speicher-Logik

Kompatibilität WR ↔ Speicher aus Stammdaten; inkompatible Wahl →
Auswahl gar nicht anbieten (Filter, kein Fehler hinterher).
Speichergröße in Modulschritten wählbar.

---

## 6. Ertragsberechnung

- **PVGIS v5 API** (seriennutzbar, kostenlos, kein Key) je
  Flächen-/Gruppen-Kombination: Standort (lat/lon), Neigung, Azimut,
  Systemverlust 14 % Default (Tenant-einstellbar) → spez. Ertrag
  kWh/kWp und Monatswerte.
- Aufrufe serverseitig (Route Handler) mit Cache: Schlüssel
  (lat/lon gerundet 4 Dezimalen, Neigung, Azimut, Verlust),
  Ablauf 90 Tage. Während des Planens wird bei Neigungs-/
  Azimut-Änderung debounced (800 ms) neu geholt; bis dahin lineare
  Interpolation aus letzten Werten, KPI-Leiste zeigt „~" vor dem
  Wert.
- Gesamtertrag = Σ über Gruppen (kWp_Gruppe · spez. Ertrag der
  Fläche/Ausrichtung). Monatsprofil wird für die Wirtschaftlichkeit
  mitgeführt.
- PVGIS nicht erreichbar → Fallback-Tabelle (AT/DE, spez. Ertrag je
  Azimut/Neigung in 5°-Schritten, mitgeliefert) + Badge „geschätzt".
  Nie ein blockierter Planer wegen einer externen API.

---

## 7. Wirtschaftlichkeit

Eingaben (alle vorbelegt, alle editierbar): Jahresverbrauch (Chips
wie Prototyp: Basis 2/4 Personen + additiv Wärmepumpe/E-Auto),
Strompreis, Einspeisevergütung, Anlagenpreis (vorbelegt aus
Richtpreislogik: Tenant-Einstellung €/kWp gestaffelt + Speicherpreis
aus Stammdaten; immer überschreibbar), Förderung (Betrag, Vorbelegung
je Bundesland aus Tenant-Tabelle — Beträge pflegt der Betrieb, keine
automatische Förderdatenbank in v1).

Rechenmodell (verbindlich, kein Viertelstunden-Modell in v1):

```
EV-Quote ohne Speicher = clamp(0,22 + 0,38 · min(1, Verbrauch/Ertrag), 0,20, 0,55)
EV-Quote mit  Speicher = min(0,82, EV-Quote_ohne + 0,27 · f_sp)
   f_sp = min(1, Speicher_kWh / (Verbrauch/365))     [Speicher relativ zum Tagesverbrauch]
Eigenverbrauch = min(Ertrag · EV-Quote, Verbrauch · 0,99)
Autarkie       = Eigenverbrauch / Verbrauch
Einspeisung    = Ertrag − Eigenverbrauch
Ersparnis/Jahr = Eigenverbrauch · Strompreis + Einspeisung · Vergütung
Amortisation   = (Anlagenpreis − Förderung) / Ersparnis_Jahr1
20-Jahre-Kurve = kumulierte Ersparnis mit Strompreissteigerung
                 (Default 2 %/a, Tenant-einstellbar) − Investition
```

Alle Konstanten (0,22 / 0,38 / 0,27 / Grenzen) als benannte
Konfiguration an einer Stelle, mit Kommentar — sie werden nach
Praxisfeedback kalibriert. UI wie Prototyp: Donut, Jahresbalken,
Amortisation groß, 20-Jahre-Kurve mit Break-even, Speicher-Toggle
morpht alles. Speicher-Toggle wirkt auch auf Preis und Stückliste.

---

## 8. Phase 5: PDF & Übergabe

### 8.1 Kunden-PDF (serverseitig generiert)

Seiten: (1) Deckblatt mit Karten-/Foto-Ausschnitt inkl. gerenderter
Belegung (Canvas-Export als Bild), Anlagen-Eckdaten; (2) Anlage im
Detail: Flächen, Gruppen, Module, WR, Speicher, „elektrisch
geprüft"-Status; (3) Ertrag: Monatsbalken, spez. Ertrag, Quelle
PVGIS/geschätzt; (4) Wirtschaftlichkeit: Donut, Amortisation,
20-Jahre-Kurve, Annahmen transparent als Liste; (5) Komponentenliste
OHNE EK/Interna; (6) Rückseite Betrieb (Briefkopf, Kontakt).
Tenant-Logo/Briefkopf aus Einstellungen. Versand per Mail direkt aus
Phase 5, PDF hängt am Projekt.

### 8.2 Übergabe als Vorgang

Button „Als Vorgang übernehmen" (Bestätigungsdialog zeigt, was
entsteht):

- Neuer Vorgang (Phase anfrage oder angebot — Wahl im Dialog) mit
  Kunde (bestehenden suchen oder anlegen), Adresse, kWp, Speicher.
- **Bedarfsliste vorbefüllt** aus der Planung: Module je Typ mit
  Stückzahl, WR, Speicher, Aufständerung/UK als Positionen (Mapping
  Planer-Stammdaten ↔ Artikelstamm über Artikelreferenz am
  Stammdatensatz; ohne Referenz → Position als Freitext mit
  Hinweis-Badge „Artikel zuordnen").
- Planer-Projekt und PDF hängen als Dokumente am Vorgang; Link in
  beide Richtungen (Vorgang → „Planung öffnen").
- Erneute Übergabe nach Planänderung: aktualisiert die Bedarfsliste
  NICHT automatisch, sondern zeigt einen Abgleich (hinzugefügt/
  entfernt/geändert) mit Übernehmen-Auswahl — die Bedarfsliste
  gehört laut Material-Briefing dem Betrieb.

### 8.3 Projektliste

Wie Design-Briefing: Karten-Grid mit Belegungs-Thumbnail (gerendertes
Bild beim Speichern erzeugt), Adresse, kWp, Status (Entwurf /
übergeben als V-XXXX), Suche, Duplizieren. Navigationspunkt „Planer"
in der Betriebs-App (gf, buero, bauleitung; monteur/lager sehen den
Planer nicht).

---

## 9. Persistenz (fachlich)

Projekt als versionierbares Dokument: Stammdaten-Referenzen + eine
Geometrie-Struktur (Flächen mit Punkten in Metern, Hindernisse,
Gruppen mit Raster-Parametern und Modul-Zuständen inkl. freier
Positionen, Strings, Wirtschaftlichkeits-Eingaben, aktiver
Karten-Anbieter, Foto+Kalibrierung). Autosave als Ganzes (debounced
2 s), Undo-Stack nur clientseitig. Tenant-isoliert wie alles (RLS,
Isolationstests erweitern). Duplizieren = Kopie mit neuem Namen.

---

## 10. Rollen

| Rolle | Planer |
|---|---|
| gf, buero | voll |
| bauleitung | voll, ohne Preis-Editierfelder (sieht Richtpreis) |
| monteur, lager | kein Zugriff, kein Navigationspunkt |

---

## 11. Was bewusst NICHT gebaut wird (Scope-Schutz)

- Kein 3D, keine Dachrekonstruktion aus Bildern, keine automatische
  Dacherkennung (v2-Kandidat: Google Solar API)
- Keine Verschattungssimulation durch Objekte (PVGIS-Systemverlust
  deckt pauschal ab); keine Horizontaufnahme
- Keine Viertelstunden-Lastprofilsimulation (v2)
- Keine Kabelwege-/Stringlängenplanung auf dem Dach, keine
  Kabelverluste je Meter
- Keine Statik-/Windlastberechnung (Randzonen nur als Hinweis)
- Keine automatische Förderdatenbank (Beträge pflegt der Tenant)
- Kein Vertragsdokument/keine Unterschrift im Planer (das PDF ist
  Information, das Angebot entsteht im Vorgang)

---

## 12. Abnahmetests

**Geometrie & Karten**
1. Polygon 10 × 7 m zeichnen → Kantenpillen zeigen 10,00/7,00 m;
   Anbieter Google→Basemap→Apple wechseln, Zoom ändern → gespeicherte
   Koordinaten byte-identisch, Pillen unverändert.
2. Kantenlänge antippen, „12,4" eintippen → Kante exakt 12,40 m.
3. Walmdach über Assistent: 4 Flächen (2 Trapeze, 2 Dreiecke),
   jede einzeln belegbar, Dreiecksfläche schneidet Module am
   schrägen Rand korrekt ab (kein Modul ragt hinaus).
4. Konkaves L-Dach von Hand: Auto-Belegung füllt beide Schenkel,
   kein Modul in der Innenecke außerhalb des Polygons.
5. Neigung 45°, Modul 1,762 m Falllinie → Draufsicht-Höhe
   1,246 m (±1 cm); wahre Fläche und kWp unverändert gegenüber 30°.
6. Drohnenfoto: Referenz 8,00 m kalibrieren, Strecke von 4,00 m
   messen → Anzeige 4,00 m (±2 %). Zweite Referenz mit 5 %
   Abweichung → Verzerrungs-Warnung.

**Gruppen & Module**
7. Auto-Belegung → eine Gruppe; Auswahl über 6 Module → „abtrennen"
   → zwei Gruppen; Gruppe 2 um 1,5 m verschieben → alle 6 wandern,
   Kollision mit Gruppe 1 unmöglich (Zug stoppt).
8. Gruppe über den Kamin ziehen → betroffene Module werden
   entfernt-markiert; Gruppe zurückziehen → Module erscheinen wieder.
9. Einzelmodul per Long-Press aus dem Raster ziehen, frei neben der
   Gruppe platzieren (snappt an Nachbarkante), „ins Raster zurück"
   → springt auf nächste freie Zelle.
10. Zwei Gruppen mit unterschiedlichem Rasterwinkel (0° und 12°) auf
    einer Fläche gleichzeitig — beide korrekt gerendert und geprüft.
11. Querformat-Umschaltung einer Gruppe ändert nur diese Gruppe.
12. Flachdach O/W: Reihenabstands-Vorschlag ändert sich mit
    Aufständerungswinkel; Ertrag nutzt beide Azimute.
13. Undo über eine Kette Zeichnen→Belegen→Gruppe verschieben→Modul
    frei ziehen → 4 × Undo stellt exakt den Ausgangszustand her.

**Elektrik (Unit-Tests mit Testvektoren aus 5.3)**
14. Alle vier Testvektoren exakt; Fehlertexte enthalten die
    berechneten Werte und die Lösung („maximal N Module").
15. 3 nicht zugeordnete Module → „geprüft" unmöglich, Pill nennt 3.
16. Zwei parallele Strings 12/14 Module am selben MPPT → Warnung
    ungleiche Stringlänge.

**Ertrag & Wirtschaftlichkeit**
17. PVGIS-Aufruf gecacht: zweite identische Anfrage ohne externen
    Call (Cache-Hit im Log). PVGIS offline → Fallback-Wert + Badge
    „geschätzt", Planer voll benutzbar.
18. Speicher-Toggle verändert EV-Quote, Autarkie, Preis, Amortisation
    konsistent; Rechenkette von Hand nachrechenbar mit den Formeln
    aus Abschnitt 7 (Toleranz Rundung).
19. Bundesland wechseln → Fördervorbelegung wechselt, manuell
    überschriebener Betrag bleibt bei Wechsel erhalten (Hinweis).

**PDF & Übergabe**
20. PDF: Deckblatt zeigt die tatsächliche Belegung als Bild, Seite 5
    ohne EK-Preise; „ungeprüft"-Vermerk erscheint genau dann, wenn
    die elektrische Prüfung nicht grün ist.
21. Übergabe: Vorgang mit vorbefüllter Bedarfsliste (Stückzahlen =
    aktive Module je Typ), Planer-Link am Vorgang; Planänderung +
    erneute Übergabe → Abgleichsdialog statt stiller Überschreibung.
22. Modul ohne Artikelreferenz → Freitextposition mit Badge.

**Allgemein**
23. iPad Safari: Pinch-Zoom, Zwei-Finger-Pan, Ein-Finger zeichnen/
    ziehen, Long-Press-Modulzug — flüssig mit 200 Modulen.
24. monteur-Login: kein Planer-Navigationspunkt, Planer-Routen 403.
25. Tenant-Isolation auf allen Planer-Daten (Tests erweitern).

---

## 13. Vorgehen (Stufen, jede einzeln abnehmbar)

**Testabgrenzung (verbindlich):** Getestet wird in diesem Auftrag NUR
der Planer — die Unit-Tests aus Abschnitt 5.3 und die Abnahmetests
aus Abschnitt 12. Die bestehenden E2E-Suiten des restlichen Systems
(Vorgänge, Zeiten, Material, Portal) werden NICHT ausgeführt, nicht
repariert und nicht angefasst; neue Planer-Tests laufen als eigene,
separat startbare Suite (eigenes Testkommando, z. B.
`test:e2e:planer`). Einzige Ausnahme: der Übergabe-Test 21 darf die
minimal nötigen Vorgangs-Funktionen mitbenutzen, ohne deren Suite zu
starten. Schlägt außerhalb des Planers etwas fehl, wird es notiert,
nicht gefixt.

1. Karten-Engine (4 Anbieter, Tile-Mathematik, lokales Metersystem,
   Adresssuche) + Canvas-Grundgerüst mit Pan/Zoom
2. Zeichnen: Polygone, Editieren, Maßeingabe, Snapping, Hindernisse,
   Falllinie, Dachform-Assistent, Messen; Drohnenfoto + Kalibrierung
3. Belegung: Auto-Belegung, Modulgruppen (verschieben/drehen/teilen/
   erweitern), Einzelmodul frei ziehen mit Snapping + Kollision,
   Flachdach-Aufständerung — DIE Kernstufe, Screenshot-Review vor
   allem Weiteren
4. Stammdaten (Katalog-Seed ~50 Geräte) + Strings + elektrische
   Prüfung mit Testvektoren
5. PVGIS + Cache + Fallback; Wirtschaftlichkeit
6. PDF + Projektliste + Übergabe als Vorgang
7. Abnahmetests komplett, iPad-Feinschliff

Design und Interaktionsmuster: exakt Planer-HTML.html
(Phasen-Stepper, Panel rechts, KPI-Leiste, Klartext-Fehlerzeilen,
Wow-Momente). CI: Solstep Betrieb, keine neuen Farbwelten außer den
String-Farben.
