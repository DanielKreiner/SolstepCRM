# Planer — Abnahmetests aus BRIEFING-planer-1.md §12

Wo jeder der 25 Abnahmetests geprüft wird, und was davon bewusst nicht
automatisiert ist. Die Zuordnung ist der Zweck dieser Datei: Ohne sie
lässt sich bei der Abnahme nicht sagen, ob ein Punkt abgedeckt ist oder
nur so aussieht.

Ausgeführt wird alles mit `pnpm test:e2e:planer` (Oberfläche) und
`pnpm vitest run lib/planer` (Rechenkerne).

## Geometrie & Karten

| # | Inhalt | Geprüft in |
|---|--------|-----------|
| 1 | Anbieter-/Zoomwechsel lässt Koordinaten unverändert | `e2e/planer-abnahme.spec.ts` — Geometrie wird vor und nach dem Zoom aus der Datenbank verglichen |
| 2 | Kantenlänge eintippen → exakt | `e2e/planer-zeichnen.spec.ts` |
| 3 | Walmdach-Assistent, 4 Flächen | `e2e/planer-zeichnen.spec.ts` |
| 4 | Konkaves L-Dach, kein Modul in der Innenecke | `lib/planer/module.spec.ts` — jede Modulecke gegen das Polygon |
| 5 | Neigung 45° → Draufsicht 1,246 m | `lib/planer/module.spec.ts` |
| 6 | Drohnenfoto kalibrieren, Verzerrungswarnung | `e2e/planer-foto.spec.ts` |

## Gruppen & Module

| # | Inhalt | Geprüft in |
|---|--------|-----------|
| 7 | Abtrennen, verschieben | `e2e/planer-belegung.spec.ts` |
| 8 | Gruppe über den Kamin und zurück | `lib/planer/module.spec.ts` — Modulzahl kehrt exakt zurück |
| 9 | Einzelmodul lösen, frei setzen, zurückholen | `e2e/planer-belegung.spec.ts` (Werkzeug „Modul"), `e2e/planer-abnahme.spec.ts` (abgelegt neben dem Dach → zurück ins Raster) |
| 10 | Zwei Rasterwinkel auf einer Fläche | `lib/planer/module.spec.ts` |
| 11 | Querformat wirkt nur auf eine Gruppe | `lib/planer/module.spec.ts` |
| 12 | Flachdach O/W, Reihenabstand, beide Azimute | `e2e/planer-belegung.spec.ts`, `lib/planer/ertrag.spec.ts` |
| 13 | Undo über eine Kette | `e2e/planer-zeichnen.spec.ts` |

## Elektrik

| # | Inhalt | Geprüft in |
|---|--------|-----------|
| 14 | Alle vier Testvektoren | `lib/planer/elektrik.spec.ts` |
| 15 | Unzugeordnete Module verhindern „geprüft" | `lib/planer/elektrik.spec.ts` |
| 16 | Ungleich lange parallele Strings | `lib/planer/elektrik.spec.ts` |

## Ertrag & Wirtschaftlichkeit

| # | Inhalt | Geprüft in |
|---|--------|-----------|
| 17 | PVGIS gecacht, Fallback bei Ausfall | `e2e/planer-ertrag.spec.ts` — der Fallback wird mit einer echten PVGIS-Absage geprüft (Punkt im Pazifik) |
| 18 | Speicher-Toggle konsistent | `e2e/planer-ertrag.spec.ts`, Rechenkette in `lib/planer/wirtschaft.spec.ts` |
| 19 | Region wechseln, getippter Betrag bleibt | `e2e/planer-vorgaben.spec.ts` |

## PDF & Übergabe

| # | Inhalt | Geprüft in |
|---|--------|-----------|
| 20 | PDF mit Belegungsbild, Prüfvermerk | `e2e/planer-pdf.spec.ts`, `e2e/planer-abnahme.spec.ts` |
| 21 | Übergabe mit Bedarfsliste, Abgleich statt Überschreiben | `e2e/planer-uebergabe.spec.ts` |
| 22 | Modul ohne Artikelreferenz → Freitext mit Hinweis | `e2e/planer-uebergabe.spec.ts`, `lib/planer/uebergabe.spec.ts` |

## Allgemein

| # | Inhalt | Geprüft in |
|---|--------|-----------|
| 23 | iPad-Gesten, 200 Module flüssig | `e2e/planer-abnahme.spec.ts` — **teilweise**, siehe unten |
| 24 | Monteur: kein Navigationspunkt, Routen gesperrt | `e2e/planer.spec.ts` |
| 25 | Mandantentrennung auf allen Planer-Daten | `e2e/planer-mandant.spec.ts` |

## Bedienung: was der Umbau vom 12.08.2026 geändert hat

Die Oberfläche wurde neu gebaut — ein Schritt, eine Frage, grosse
Knöpfe. Für die Abnahme heisst das:

| Vorher | Jetzt |
|--------|-------|
| „Standardform setzen" + Auswahlliste | „Dachform setzen" + Karten je Dachform |
| „Fläche automatisch belegen" in Schritt 1 | Schritt 2 „Dach voll belegen", nach der Modulwahl |
| Modulwahl in Schritt 3 (nach der Belegung) | Modulwahl in Schritt 2, VOR der Belegung — die Modulmasse bestimmen das Raster |
| Alle Schritte jederzeit anklickbar | Ein Schritt setzt voraus, was der vorige liefert; der Grund steht am Knopf |
| Langer Druck löst ein Modul | Nur noch das Werkzeug „Modul" — der lange Druck löste ständig aus Versehen aus |
| Randabstand, Traufe, Gebäudemasse, Foto sichtbar | hinter „Mehr einstellen" |

Zwei Fehler, die dabei gefunden und behoben wurden, sind eigene Tests
wert und haben welche bekommen:

- **Weggetippte Module kamen zurück**, sobald die Gruppe bewegt wurde.
  `aus` (kein Platz) und `entfernt` (weggetippt) liegen jetzt getrennt —
  `lib/planer/module.spec.ts`.
- **Frei gezogene Module liessen sich neben das Dach legen** und zählten
  in der Stückliste mit — `e2e/planer-abnahme.spec.ts`.
- **Das Luftbild war ab etwa fünf Metern Bildbreite verzerrt**: Die
  CSS-Grundeinstellung `img { max-width: 100% }` staucht eine Kachel,
  die breiter ist als das Fenster — die Höhe blieb, die Breite nicht.
  Von Hand nachzuprüfen (ein Test darauf wäre ein Test auf einen
  CSS-Reset, nicht auf das Verhalten): weit heranzoomen, das Bild muss
  scharf und unverzerrt bleiben.

## Zusätzlich: räumliche Ansicht (BRIEFING-planer-3d.md)

Nicht Teil der 25 Punkte, aber mit demselben Anspruch geprüft.

| Inhalt | Geprüft in |
|--------|-----------|
| Gebäudemodell aus Dachtyp, Wandhöhe, Überstand | `lib/planer/gebaeude.spec.ts` — Flächensumme gegen die Draufsicht |
| Sonnenstand | `lib/planer/sonne.spec.ts` — gegen die nachgerechneten Mittagshöhen für Linz |
| Schattenwurf, Verschattungsgrad, Ertragsfaktor | `lib/planer/verschattung.spec.ts` |
| Baum senkt den Ertrag und färbt die Module | `e2e/planer-verschattung.spec.ts` — Ertrag aus der Kennzahlenleiste, Färbung an den Bildpunkten der Leinwand |
| Baum setzen, bemassen, entfernen | `e2e/planer-verschattung.spec.ts` |
| Sperre je Schritt (Dach, Belegung, Strings) | `e2e/planer-phasen.spec.ts` |

## Was NICHT automatisiert ist

**Pinch-Zoom und Zwei-Finger-Schwenk (Teil von 23).** Playwright kennt
keine Pinch-Geste. Synthetische Pointer-Ereignisse und auch
`Input.dispatchTouchEvent` über das DevTools-Protokoll lösen den Zoom
nicht aus, weil der Handler mit Pointer-Capture arbeitet — das greift
nur bei echten Eingaben. Automatisiert geprüft wird deshalb die
Voraussetzung (`touch-action: none`, ohne das verarbeitet iOS Safari
die Gesten selbst) und dass Ein-Finger-Eingaben ankommen. Das Verhalten
der Gesten am Gerät bleibt eine Prüfung von Hand.

**Echter Schattenwurf im Bild.** Die Verschattung wird gerechnet und als
Färbung gezeigt, nicht als geworfener Schatten im Renderer. Eine
Lichtquelle würde ein zweites Ergebnis zeigen, das nicht zwingend zur
Ertragsrechnung passt.

**Bildwiederholrate bei 200 Modulen (Teil von 23).** Messbar ist hier
nur die Antwortzeit: Ein Tipp auf ein Modul muss binnen einer Sekunde
wirken, geprüft mit einer 40 × 20 m grossen Halle. Ob die Karte dabei
flüssig läuft, sagt kein Testlauf im Hintergrund verlässlich.

## Ziehen und Setzen (13.08.2026)

Drei Meldungen aus der Benutzung, alle bestätigt und behoben:

| Was war | Was jetzt | Geprüft in |
|---------|-----------|-----------|
| Eine gesetzte Dachform liess sich nur über die Ecken verformen | Ziehen in der gewählten Fläche verschiebt sie samt Hindernissen und Belegung | `e2e/planer-zeichnen.spec.ts` |
| Beim Ziehen einer Ecke sprang die Kante von 18 auf 21 m | Fang projiziert lotrecht und greift erst im Umkreis von zwölf Bildpunkten | `lib/planer/flaeche.spec.ts` |
| Nur „Dach voll belegen"; ein einzelnes Modul ging nicht | Werkzeug „Setzen" mit Geistermodul am Zeiger — grün passt, rot passt nicht | `e2e/planer-setzen.spec.ts`, `lib/planer/module.spec.ts` |

Der Sprung war kein Zufallsfehler, sondern die Winkeltoleranz: Der Fang
beim Zeichnen dreht den Punkt um den Bezugspunkt und behält die Länge.
Bei 18 m Abstand sind 4° eben 1,26 m. Beim Ziehen einer bestehenden Ecke
ist das die falsche Rechnung — dort zählt der Abstand zum Strahl, nicht
der Winkel.

## Ost/West-Aufständerung — die Zahl, die falsch war

Bis 13.08.2026 wurde die Aufständerungsart zwar gespeichert, aber
nirgends gerechnet: Nur der Winkel ging in den Ertrag ein, die Richtung
nicht. Ein Ost/West-Flachdach wurde also mit dem Azimut der Dachfläche
gerechnet — und der stammt beim Flachdach aus einer beliebigen
Traufkante.

Jetzt bestimmt das Gestell die Ausrichtung (`ausrichtungen()` in
`lib/planer/module.ts`):

- **Süd:** alles nach Süden, im Gestellwinkel — unabhängig davon, wie
  das Flachdach selbst orientiert ist
- **Ost/West:** zwei Hälften, 90° und 270°, getrennt gerechnet und nach
  Leistung gewichtet

Der Mittelwert aus Ost und West wäre Süden; der Ertrag läge über zehn
Prozent zu hoch. Bildschirm und PDF benutzen dieselbe Funktion.
Geprüft in `lib/planer/module.spec.ts`.

## Vorgang ↔ Planung (13.08.2026)

Der Weg lief bisher nur in eine Richtung: Aus einer fertigen Planung
liess sich ein Vorgang machen. Umgekehrt ging nichts.

| Inhalt | Geprüft in |
|--------|-----------|
| Planung aus dem Vorgang anlegen, Verweis in beide Richtungen | `e2e/planer-bruecke.spec.ts` |
| Geräte der Planung als Angebotspositionen, Preis aus dem Artikelstamm | `e2e/planer-bruecke.spec.ts` |
| Zweiter Klick legt nichts doppelt an | `e2e/planer-bruecke.spec.ts` |
| Artikelbezug bei einem Modultyp, auch nach Umbenennen | `lib/planer/uebergabe.spec.ts` |

Ob überhaupt geplant wird, entscheidet der Betrieb: Für einen
Speichertausch braucht niemand ein Dachmodell. Die Karte im
Angebotsreiter bietet es an, verlangt es aber nicht.

## Die Tests laufen gegen die Arbeitsdatenbank

Es gibt kein eigenes Testprojekt bei Supabase; die E2E-Suite legt ihre
Daten dort an, wo auch gearbeitet wird. Am 13.08.2026 hat sich gezeigt,
was das heisst: **1965 Planer-Projekte** und 60 „Prüfkunden" aus drei
Tagen Testläufen standen in den Listen, alle auf zwei erfundenen
Adressen (Linz Hauptplatz und Lindgraben im Burgenland). Wer den Planer
öffnete, landete in einem Testprojekt statt bei seinem Kunden.

Seither räumt der Lauf hinter sich auf: `e2e/lauf-start.ts` schreibt
eine Startmarke, `e2e/lauf-ende.ts` löscht danach alles, was NACH dieser
Marke entstanden ist — Planer-Projekte und Kunden mit dem Namensanfang
„Prüfkunde". Was vorher dastand, bleibt.

Das ersetzt kein Staging-Projekt. Solange es keines gibt, gilt: Nach
einem abgebrochenen Lauf (Strg-C, Absturz) einmal in die Projektliste
schauen.

## Bekannte Einschränkung der Testumgebung

Der Entwicklungsserver verliert bei über sechzig Tests am Stück
gelegentlich einen Test durch Zeitüberschreitung — in jedem Lauf einen
anderen, jeweils einzeln grün. Die Ursache und der verworfene
Lösungsversuch (Produktionsbuild als Testserver) stehen als Kommentar
in `playwright.config.ts`.

## Räumliche Ansicht und Strings (13.08.2026)

| # | Prüfung | Erwartung |
|---|---|---|
| R1 | 3D öffnen | Dachflächen tragen das Luftbild, der Boden ist dunkler, jede Dachkante ist sichtbar |
| R2 | „Belegen" wählen, über das Dach fahren | Geistermodul am Zeiger, grün wo es passt, rot am Rand |
| R3 | Tippen | genau ein Modul, sofort gespeichert, auch in der Draufsicht da |
| R4 | Auf ein Modul tippen | Modul weg, Gruppe verschwindet wenn sie leer wird |
| R5 | Ziehen im Belegen-Modus | Kamera dreht, kein Modul entsteht |
| R6 | Schritt 3, „Strings automatisch verlegen" | jedes belegte Modul hängt an genau einem String, Längen unterscheiden sich um höchstens eins |
| R7 | Zwei Dachflächen belegen und verlegen | kein String läuft über beide Flächen |
| R8 | Kabelweg | heller Strich über den Modulen, Scheibe am Anfang, Ring am Ende — in 2D und 3D |

| R9 | Sperrzone aufziehen | gelb schraffiert mit gestricheltem Saum, in Draufsicht UND 3D |
| R10 | Schritt 3, Umschalter „Strings", Modul antippen | Modul landet im gewählten String, nochmal tippen nimmt es heraus |
| R11 | Bildquelle wechseln | 3D lädt die Kacheln über `/api/planer/kachel/...`; kommt keine an, steht es im Bild |

Ohne gewählten Wechselrichter bleibt der Verlegeknopf gesperrt: Die
Stringlänge kommt aus der Kaltspannung des Moduls und dem MPP-Fenster
des Geräts, geraten wird sie nicht.

## Setzen und Sperrzonen (13.08.2026, zweiter Durchgang)

| # | Prüfung | Erwartung |
|---|---|---|
| S1 | In 3D neben ein bestehendes Feld tippen | Modul hängt am selben Feld, kein „Feld 2" |
| S2 | Dasselbe in der Draufsicht mit „Modul einzeln setzen" | gleiches Ergebnis, gleiches Raster |
| S3 | Auf ein weggetipptes Modul tippen | es kommt zurück, ohne neues Feld |
| S4 | Auf ein vorhandenes Modul tippen (Setzen) | „Hier liegt schon ein Modul." |
| S5 | Weit weg vom Feld tippen | jetzt erst entsteht ein neues Feld |
| S6 | Sperrzone anfassen und ziehen | Zone wandert mit, Grösse bleibt |
| S7 | Eckgriff der Zone ziehen | Zone wird grösser/kleiner, gegenüberliegende Ecke bleibt |
| S8 | Zone über Module schieben | die Module darunter fallen heraus und kommen zurück, wenn sie weiterwandert |

Die Vorschau zeigt beim Anschluss die Rasterlage des Nachbarfeldes,
nicht die Zeigerposition — sonst verspricht das Geisterbild eine Lage,
die das Setzen nicht einhält.
