# BRIEFING: Planer in 3D

Daniel hat sich den Reonic-Planer angesehen und will dieselbe
Arbeitsweise. Der grösste Unterschied ist die dritte Dimension: Reonic
baut aus Dachtyp, Wandhöhe und Neigung ein Gebäudemodell, legt die
Module darauf und zeigt Verschattung durch Nachbargebäude und Bäume.

Dieses Briefing hält fest, was das umfasst, in welcher Reihenfolge es
entsteht und was dabei am bestehenden 2D-Planer bleibt. Es ist der
Nachfolger von BRIEFING-planer-1.md, nicht dessen Ersatz: Geometrie,
Elektrik, Ertrag und Wirtschaftlichkeit sind fertig und rechnen weiter.

## 1. Was aus dem Reonic-Durchgang feststeht

Beobachtet am 11.08.2026 in einem echten Angebot:

- **Drei Schritte** oben in der Mitte: Gebäude → Module → Strings.
  Jeder Schritt hat seine eigene Werkzeugleiste unten in der Mitte.
- **Gezeichnet wird in 2D**, angezeigt in 3D. Beim Aktivieren des
  Zeichenwerkzeugs schaltet die Ansicht selbsttätig auf Draufsicht; ein
  Umschalter unten links wechselt jederzeit.
- **Gebäude aus Parametern**: Dachtyp (Walm/Sattel/Flach), Aussenwand-
  höhe, Standard-Einfügung, Dachüberstand. Die Dachseiten erscheinen
  daneben als kleine Skizze mit ihren Winkeln.
- **Module anbauen mit +**: Rings um die Belegung sitzt an jeder freien
  Randposition eine Marke. Ein Klick setzt genau ein Modul; die Marke
  rückt danach eine Position weiter nach aussen. Geprüft: 58 → 59
  Module.
- **Gruppe**: Verschieben und Drehen als Symbole am Rahmen, dazu
  „Auto Update" und „Duplizieren".
- **Strings**: Farbe je String, Zuordnung an die MPP-Tracker des
  Wechselrichters, DC/AC-Verhältnis als Badge („104 %").
- **Verschattung** als eigener Schalter unten links, mit Bäumen als
  setzbaren Objekten.

Was davon schon steht: die +-Bedienung, die Strings samt Tracker-
Zuordnung und das DC/AC-Verhältnis.

## 2. Was NICHT übernommen wird

Die konkrete grafische Gestaltung — Farben, Symbole, Anordnung im
Detail. Der Planer bleibt in der Solstep-CI. Übernommen wird die
Arbeitsweise, nicht das Aussehen.

## 3. Stufen

Jede Stufe ist für sich abnehmbar und lässt den Planer benutzbar.

### 3D-1 Gebäudemodell aus Parametern

Aus dem gezeichneten Grundriss plus Dachtyp, Wandhöhe und Neigung
entstehen die Dachflächen — statt jede Fläche einzeln zu zeichnen.

- Walmdach: vier Flächen (zwei Trapeze, zwei Dreiecke)
- Satteldach: zwei Trapeze plus zwei Giebelwände
- Flachdach: eine Fläche
- Dachüberstand als Versatz nach aussen
- Ergebnis sind dieselben `Dachflaeche`-Objekte wie heute — die
  Belegung, die Elektrik und der Ertrag rechnen unverändert weiter.

Ohne Renderer, rein als Geometrie mit Unit-Tests. Damit ist der
schwierigste Teil abgesichert, bevor irgendetwas gezeichnet wird.

### 3D-2 Renderer

- `three` als Abhängigkeit, ohne React-Wrapper: Der Planer hält seine
  Kamera schon heute in Refs statt im State, weil sonst 60 fps nicht
  zu halten sind. Ein deklarativer Wrapper würde das rückgängig machen.
- Boden als Luftbild-Textur aus den vorhandenen Kacheln
- Gebäudekörper aus 3D-1, Module als Flächen darauf
- Orbit-Steuerung: Ziehen dreht, Zwei-Finger schwenkt, Rad zoomt
- Umschalter 2D/3D; im 2D-Zustand bleibt exakt der heutige Canvas

**Erledigt.** Boden mit Luftbild, Gebäude aus den Dachflächen, Module
darauf, Umlaufsteuerung. Wandhöhe und Dachüberstand sind im Panel
einstellbar und liegen im Plan.

### 3D-3 Verschattung

- Sonnenstand aus Datum, Uhrzeit und Standort
- Schattenwurf von Nachbargebäuden und gesetzten Bäumen
- Verschattungsgrad je Modul über das Jahr, als Faktor in den Ertrag
- Anzeige als Färbung der Module

**Erledigt.** Sonnenstand nach Meeus in `lib/planer/sonne.ts`, gegen die
nachgerechneten Mittagshöhen für Linz geprüft (65,13° / 41,69° / 18,25°).
Schattenwurf geometrisch als Strahl: Bäume als Zylinder, Nachbargebäude
als Prisma über dem Grundriss. Der Verschattungsgrad je Modul geht als
Faktor in den Ertrag und steht als eigene Kennzahl „SCHATTEN" neben dem
Jahresertrag — nicht versteckt im Ertrag, damit sichtbar bleibt, was ein
Baum kostet. Verschattete Module werden in der Draufsicht dunkler und in
der räumlichen Ansicht heller gezeichnet (auf dunklem Modulblau ist
Abdunkeln nicht zu sehen). Bäume werden mit dem Werkzeug gesetzt und im
Panel „Umgebung" bemasst.

Nicht gebaut: eine echte Lichtquelle mit Schattenwurf im Renderer. Sie
würde ein zweites Ergebnis zeigen, das nicht zwingend zur
Ertragsrechnung passt — zwei Wahrheiten über denselben Schatten.

### 3D-4 Bedienung angleichen

- ✓ Schritte oben in der Mitte statt links
- ✓ Werkzeugleiste unten in der Mitte, je Schritt anders belegt
- ✓ „Duplizieren" für Modulgruppen
- ✓ Ein Schritt sperrt, was der vorige festgelegt hat
- ✓ Verschieben und Drehen als Symbolpaar über dem Gruppenrahmen. Aus der
  Darstellungsfrage wurde dabei doch eine Verhaltensfrage: Verschieben
  ging bisher nur durch Ziehen IN der Fläche, und ein zu kurzer Zug
  schaltete das Modul darunter ab. Das Symbol hat deshalb seinen eigenen
  Zug, der nie ein Modul schaltet. Die Kantengriffe bleiben Quadrate —
  sie ändern die Grösse, und dafür ist das Quadrat das gewohnte Zeichen.

**Erledigt.** Damit ist BRIEFING-planer-3d.md abgearbeitet.

## 4. Was bleibt

Die gesamte Rechnerei aus BRIEFING-planer-1.md bleibt unangetastet:
Metersystem, Modulraster, elektrische Prüfung mit ihren Testvektoren,
PVGIS mit Cache und Fallback, Wirtschaftlichkeit, PDF, Übergabe an
einen Vorgang. Die 3D-Ansicht ist eine zweite Darstellung derselben
Daten, keine zweite Wahrheit.

## 5. Reihenfolge und Aufwand

3D-1 zuerst, weil es ohne Renderer prüfbar ist und die Belegung sofort
davon profitiert (Walmdach ohne vier Einzelzeichnungen). Danach 3D-2,
das den sichtbaren Sprung bringt. 3D-3 ist die aufwendigste Stufe und
hat den geringsten Nutzen für ein Erstgespräch — sie kommt zuletzt.
3D-4 lässt sich jederzeit dazwischenschieben.
