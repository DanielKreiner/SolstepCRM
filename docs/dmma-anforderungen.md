# Anforderungen aus dem Onboarding DMMA Elektrotechnik

Quelle: Onboarding-Termin mit Manuel Lichnovsky, Transkript und Daniels Mitschrift.
Stand dieser Liste: 25. November 2026.

Jeder Punkt steht hier mit dem **Grund**, warum DMMA ihn will. Der Grund entscheidet
über die Lösung — bei mehreren Punkten ist der naheliegende Bau der falsche.

---

## 0. Die Terminlage, die alles andere sortiert

Zwei Sätze aus dem Gespräch setzen den Takt:

> „Wir haben dann ab nächstes Jahr selber kein Buchhaltungsprogramm mehr, weil wir
> dem Steuerberater übergeben."

> „Alle Mitarbeiter werden mit 1. Januar drauf umgestellt."

Damit ist der **1. Jänner 2027 ein harter Termin**, nicht ein Wunschdatum. DMMA gibt ihr
Buchhaltungsprogramm ab und hat danach kein zweites System mehr, in dem sie eine Rechnung
schreiben könnten. Was zu diesem Datum nicht steht, ersetzen sie durch Word und Excel —
und was einmal in Excel läuft, kommt nur schwer zurück.

Alles andere in dieser Liste ist wichtig, aber verschiebbar. Abschnitt 1 ist es nicht.

Das Büro lernt die Software bereits jetzt („eineinhalb Monate Eingewöhnungsphase"), die
Monteure kommen am 1. Jänner dazu. Das heißt auch: Fehler, die das Büro jetzt findet,
sind billig. Fehler, die am 2. Jänner zwölf Leute gleichzeitig treffen, sind teuer.

---

## 1. Rechnungen — muss bis 1. Jänner stehen

### 1.1 Rechnung ohne Vorgang

Heute hängt jeder Beleg zwingend an einem Vorgang (`vorgang_dokument.vorgang_id` ist
`not null`). Für den PV-Neubau ist das richtig und soll so bleiben. Aber DMMA ist ein
Elektrobetrieb, nicht nur ein PV-Betrieb:

> „Es kommt einer vorbei und holt sich einen Wechselrichter bei euch." · „Wir werden
> irgendwelche normale Angebote auch erstellen müssen mit 3 Lichtschaltern."

Für einen Handverkauf oder drei Lichtschalter einen Vorgang mit Planung, Terminierung und
Baustellenabrechnung anzulegen, ist Unsinn — das macht niemand zweimal. Es braucht einen
zweiten, kurzen Weg: Kunde, Positionen, Rechnung, fertig.

Technisch: `vorgang_id` nullable, und jede Abfrage, die heute über den Vorgang auf die
Firma schließt, braucht eine eigene `company_id`-Verknüpfung. Das ist der Punkt, an dem
man sich bei der Mandantentrennung in den Fuß schießt, also gehört er mit einem
Isolationstest abgesichert.

**Aufwand: 2–3 Tage.**

### 1.2 Vier Rechnungsarten mit korrektem Steuerausweis

Manuel hat sie explizit aufgezählt — „mehr brauchen wir nicht":

| Art | Steuer | Pflichttext auf der Rechnung |
|---|---|---|
| Normale Rechnung | 20 % USt | — |
| Bauleistung | 0 %, Steuerschuld geht über | Hinweis auf § 19 Abs. 1a UStG |
| Reverse Charge (EU-Dienstleistung) | 0 % | Hinweis auf Steuerschuld des Empfängers + UID beider Seiten |
| Innergemeinschaftliche Lieferung | 0 % | Hinweis auf steuerfreie ig. Lieferung + UID beider Seiten |

`lib/money.ts` kennt Reverse Charge schon und rechnet dann auf null. Was fehlt, ist die
Art als Eigenschaft des Belegs, der richtige Pflichttext im PDF und die Steuerkennzeichnung
im Export. Bei einer Bauleistungsrechnung ohne den Paragrafenhinweis haftet der Betrieb
für die Steuer — das ist kein Formfehler, das ist Geld.

**Wichtig:** Die drei Null-Prozent-Arten setzen die UID des Empfängers voraus. Ohne UID
darf die Rechnung nicht in diesen Arten ausgestellt werden; das muss die Maske blocken
und nicht nachträglich der Steuerberater finden.

**Aufwand: 2 Tage.**

### 1.3 UID des Geschäftskunden auf AB und Rechnung

Steht in der Mitschrift als „ATU Nummer beim Auftrag". Bei Privatkunden bleibt das Feld
leer und darf kein Pflichtfeld sein — Manuel hat ausdrücklich gefragt, ob das System
nervt, wenn keine UID da ist. Antwort muss nein sein.

**Aufwand: halber Tag.**

### 1.4 Rechnungen an das Postfach des Steuerberaters

> „Jedes Mal, wenn wir eine Rechnung schreiben, bekommt er sie auf ein Postfach, und sein
> BMD zieht sich das einfach aus dem Postfach herein und analysiert das. Mit dem kann man
> auch leben, hat er gesagt."

Das ist die einfachste Lösung, die es gibt, und sie ist schon fast gebaut: Eine zweite
Empfängeradresse je Mandant, und jede freigegebene Rechnung geht als PDF zusätzlich dorthin
in die `mail_outbox`. Kein Buchhaltungsadapter, keine Schnittstelle, kein Vertrag mit BMD.

Dazu monatlich das **Rechnungsausgangsbuch** als CSV. Manuel schickt ein Muster, wie es
bisher aus ihrem Altsystem kam; in dessen Spalte „Ost" steht bei Bauleistungen eine 0,
damit der Steuerberater sie erkennt. Der nächtliche `accounting-export` kann das liefern,
sobald die Rechnungsart am Beleg steht (1.2).

**Aufwand: 1 Tag, plus einen halben Tag sobald das Muster da ist.**

### 1.5 Anzahlung als Prozentsatz, saldiert in der Schlussrechnung

Hier ist der Punkt, den die Mitschrift als „AB bei Angebotserstellung, aber auch auf
Rechnungzahlung oder Auftragsbestätigung" festhält, und er ist feiner als er klingt.

Der Normalfall bleibt: Angebot angenommen → Auftragsbestätigung + Anzahlungsrechnung. Das
machen laut Daniel alle Betriebe so, und der Prozentsatz ist schon heute änderbar
(`anzahlungProzent`). Aber:

> „Es gibt Geschäftskunden, die können ohne Rechnung mit Steuer nicht anzahlen."

Ein Geschäftskunde braucht für die Anzahlung einen vorsteuerabzugsfähigen Beleg, und eine
Auftragsbestätigung ist keiner. Deshalb: **bei der Angebotserstellung eine Frage**, ob der
Auftrag über Auftragsbestätigung oder über Rechnung läuft. Keine Automatik nach Kundenart —
Manuel hat selbst eingewendet, dass auch Privatkunden das manchmal so wollen („wenn ich
Steuerberater bin, dann will ich das vielleicht so, weil ich es halt immer so mach").

Und die Anzahlung ist **kein Stücklisten-Abzug**, sondern ein Prozentsatz:

> „Er soll einfach nur einen Prozentsatz draus erzeugen. Ja, das reicht mir ja auch schon."

In der Schlussrechnung muss die geleistete Anzahlung dann wieder aufgelistet und abgezogen
werden. Das ist in Österreich nicht optional: Die Anzahlungsrechnung hat die Steuer schon
ausgewiesen, die Schlussrechnung muss sie herausrechnen, sonst wird zweimal abgeführt.

**Aufwand: 2 Tage.**

**Summe Abschnitt 1: rund 8 Tage.** Bei fünf Wochen bis zum Jahreswechsel ist das machbar,
aber nicht, wenn gleichzeitig Abschnitt 3 läuft.

---

## 2. Was DMMA liefern muss — hier nachfassen

Manuel hat zugesagt, das zusammenzuschreiben („schauen wir nächste Woche"). Ohne diese
Daten steht die Software leer da, und ein leeres System überzeugt niemanden. Das ist der
Punkt, an dem Onboardings kippen — nicht am Preis.

| Was | Wofür | Status |
|---|---|---|
| Kundenstamm als CSV | Grundstock; enthält Adresse, Geburtsdatum (Zusatzfeld), Fibu-Konto | zugesagt, Export geprüft |
| Lieferanten als CSV | Bestellwesen | zugesagt |
| Wechselrichter mit allen technischen Daten | ohne sie keine automatische Stringauslegung | zugesagt, Herstellernummer wichtig |
| Module | Spannung, Temperaturkoeffizient, Leistung | zugesagt |
| Speicher + Kompatibilität | automatische Artikelempfehlung | zugesagt |
| Lagerbestand | Startbestand | zugesagt |
| Resturlaub je Mitarbeiter zum Stichtag | Urlaubskonto | offen, Manuel fragt die Lohnverrechnerin |
| Urlaubsregel: pauschal oder monatlich | Berechnung | offen, hängt am Buchhaltungswechsel |
| Letzte Kunden- und Rechnungsnummer des Altsystems | fortlaufende Nummern | offen |
| Muster Rechnungsausgangsbuch | Exportformat | zugesagt |
| Prüfbefund als PDF/HTML + welche Felder vorausgefüllt | siehe 3.1 | zugesagt |

**Zum Geburtsdatum:** DMMA braucht es für den Netzzutrittsvertrag. Das Feld existiert.
Trotzdem ist es ein personenbezogenes Datum ohne betrieblichen Zweck außerhalb dieses
Vertrags — es gehört in die Löschfrist des Löschkonzepts und nicht in Exporte, die es nicht
braucht.

**Zur Kundennummer:** Manuel führt Fibu-Konten (2er Klasse Kunden, 3er Lieferanten) und
will daran anknüpfen:

> „Da müssten wir halt dann an die letzte Nummer anknüpfen, Anfang des Jahres, dass da
> weitergeht. Weil sonst werden wir ziemliches Durcheinander bringen."

Der Startwert für Nummernkreise ist seit `0076` einstellbar. Beim **Import** muss die
bestehende Nummer aber mitkommen und nicht neu vergeben werden — sonst passen die Belege
in der Buchhaltung nicht mehr zu den Kunden in der Software. Das ist eine Eigenschaft des
Importers, nicht des Nummernkreises.

---

## 3. Fachliche Erweiterungen, nach Nutzen sortiert

### 3.1 Prüfbefund und Abschlussbefund

Der inhaltlich größte Wunsch aus dem Termin, und der mit dem besten Verhältnis von Aufwand
zu Wirkung. DMMA hat den Prüfbefund schon als ausfüllbares HTML gebaut. Was sie wollen:

1. Prüfbefund am Vorgang anlegen → Kundendaten (Name, Anlagenadresse, Kundennummer)
   kommen aus dem Vorgang
2. Die verbauten Komponenten kommen aus der Auftragsbestätigung — Wechselrichtertyp,
   Module, Eckdaten
3. Der Monteur trägt vor Ort **nur noch die Messwerte** ein
4. **Befundnummer** aus einem eigenen Nummernkreis — heute führen sie dafür eine separate
   Excel-Liste
5. Ablage je Vorgang unter den Belegen
6. Dazu ein **Abschlussbefund** mit Unterschrift des Kunden, angehängt an die Fertigmeldung

> „Dann muss der Mitarbeiter vor Ort wirklich nur noch die Besichtigung machen und die
> Messwerte eintragen."

Punkt 6 existiert im Kern schon: Der Kunde kann im Portal unterschreiben. Punkt 4 ist ein
weiterer Nummernkreis, dafür steht die Mechanik. Der Aufwand liegt in 1 bis 3 und im
Formular selbst, und der hängt daran, wie viele Felder der Befund hat — deshalb erst
schätzen, wenn das PDF da ist.

Das löst eine Excel-Liste ab und spart pro Anlage eine halbe Stunde Tipparbeit. Das ist
die Art Funktion, die einen Betrieb an eine Software bindet.

**Aufwand: 3–5 Tage, Schätzung erst nach Sichtung des Formulars belastbar.**

### 3.2 Einkaufspreise aus der Bestellung statt vom Artikel

> „Wir haben einen Lieferantenpreis direkt fix drinnen. Das Problem an der Sache ist, der
> Lieferant ändert alle Wochen eigentlich."

Ein fester Lieferantenpreis am Artikel ist bei Energy3000 nach einer Woche falsch, und
damit ist jede Baustellenabrechnung falsch. Der echte Preis steht auf der
Auftragsbestätigung oder der Rechnung des Lieferanten.

Der Weg aus dem Gespräch, in dieser Reihenfolge:

1. Bestellung raus, ohne Preis
2. Danach entsteht eine Aufgabe: „Einkaufspreise für Bestellung X nachtragen"
3. Entweder manuell, oder man lädt die Lieferanten-AB/Rechnung hoch und der Import ordnet
   die Preise den Positionen zu
4. Mit dem echten Preis wird auf die Baustelle gebucht → die Nachkalkulation stimmt

Zum Punkt „KI Import je Bestellung" aus der Mitschrift: Das ist genau die Stelle, an der
CLAUDE.md eine Regel hat, und sie ist hier richtig — der Import zeigt einen Vorschau-Diff
(„12 Positionen erkannt, 2 nicht zuordenbar") und übernimmt nichts still. Ein
Einkaufspreis, den eine Automatik falsch zuordnet, verfälscht die Nachkalkulation jeder
Baustelle, auf der der Artikel liegt, und fällt erst Monate später auf.

**Rabatte:** Manuel hat nachgefragt — bekommt die Bestellung 10 % Rabatt, wird er auf alle
Positionen verteilt, nicht als eigene Zeile geführt. Daniel hat das so bestätigt. Richtig,
denn nur dann stimmt der Preis am einzelnen Artikel.

**Aufwand: 3 Tage ohne Belegerkennung, 5–6 Tage mit.**

### 3.3 Wiederbeschaffungszeit je Artikel und Erinnerung vor dem Montagetermin

Der Punkt, an dem Manuel am längsten dran war, und er hat einen betrieblichen Grund:

> „An die Dachersatzplatten hängt da die ganze Einteilung von den Baustellen. Das ist
> schon ein großer Punkt für uns."

Dachersatzziegel haben 5 bis 6 Wochen Lieferzeit. Heute erinnert das System eine Woche vor
dem Montagetermin — bei diesen Artikeln sechs Wochen zu spät, und dann wackelt die ganze
Einteilung.

Gebraucht wird eine **Wiederbeschaffungszeit am Artikel**, aus der sich die Erinnerung
ableitet: Montagetermin minus Wiederbeschaffungszeit minus Puffer. Dann erinnert der
Artikel selbst und niemand muss Fristen im Kopf haben. Das Feld „Lieferzeit in Tagen"
existiert am Lieferantenpreis — es gehört aber an den Artikel, weil die Frist eine
Eigenschaft der Ware ist und nicht des Preises.

Manuel wollte das zuerst als Häkchen je Artikel. Eine Zahl ist besser: sie trägt die
Information, wie lange, und die ist bei Wallboxen gerade ein halbes Jahr und bei
Kleinmaterial ein Tag.

**Offen geblieben:** DMMA hat über 40 verschiedene Dachziegelarten. Daniel wollte sie als
einen Artikel „Dachersatzplatte" führen, Manuel hat widersprochen:

> „Ich kann die nur in Zehnerschritten bestellen, und wenn ich 65 brauch, kommen Fünfe
> wieder zurück. Also das sollte schon ein Artikel sein, der da durchgeführt ist."

Er hat recht: Wer Bestand führen und Rückgaben buchen will, braucht den einzelnen Artikel.
Was er eigentlich will, sind **Artikelgruppen** — eine Gruppe „Ersatzplatten" mit 40
Artikeln darin, auf die Regeln wie die Wiederbeschaffungszeit einmal gesetzt werden. Das
ist die eigentliche Antwort auf seine Frage „Kann man Artikelgruppen einsetzen?", die im
Termin mit „Artikel ist immer einzeln" beantwortet wurde.

**Aufwand: 2 Tage für die Wiederbeschaffungszeit mit Erinnerung, 2 Tage für Artikelgruppen.**

### 3.4 Lieferant fest am Artikel

> „Die Dachersatzplatten, da haben wir nur einen Lieferanten, das ist der Lehmann, kann
> ich nicht fix zuweisen."

Heute wählt man bei jeder Bestellung erneut aus. Bei Artikeln mit genau einem Lieferanten
ist das vermeidbare Arbeit und eine Fehlerquelle. Ein Standardlieferant am Artikel, der
beim Bestellvorschlag vorbelegt wird und überschreibbar bleibt.

**Aufwand: 1 Tag.**

### 3.5 Lagerware in eine Kundenbestellung mitnehmen

> „Wir zahlen ja Versandkosten." · „Dass ich dann dazu bestellen kann, dass die Meldung
> kommt, wenn ich beim Kunden bestell: brauchst noch Überspannungsableiter."

Beim Bestellen für eine Baustelle soll man Lagerware mit auf dieselbe Bestellung nehmen
können, ohne dass sie dem Kunden zugebucht wird. Zwei Gründe, beide gut: ein Versand statt
zwei, und Verbrauchsware wie Blitzschutzmaterial gehört auf kein Kundenkonto.

**Aufwand: 2 Tage.**

### 3.6 Inventur

Manuel kennt das aus seiner früheren Firma und hat genau gefragt. Was er braucht:

- Stichtaginventur, nicht laufend (zum 1. Jänner sowieso fällig)
- Artikel als **„wird nicht gezählt"** markierbar. Das war ihm wichtig: Schrauben und
  Kleinteile wurden früher gewogen, „aber das brauchen wir alles nicht". Ohne diese
  Markierung zählt niemand die Inventur zu Ende
- Korrekturbuchung mit **Grund** — Schwund, beschädigt, nicht auffindbar
- Lagerorte getrennt zählbar

Im Code steht `letzte_inventur` und `inventur_intervall_tage` an Fahrzeugen, es gibt also
einen Anfang. Der Zählvorgang selbst fehlt.

**Aufwand: 4 Tage.**

### 3.7 Lieferschein- und Rechnungsnummer am Vorgang

Manuel ist dreimal darauf zurückgekommen, weil es seinen echten Fall trifft: Ein
Wechselrichter geht nach einem halben Jahr kaputt. Für die Reklamation beim Lieferanten
braucht er die Rechnungs- oder Lieferscheinnummer, unter der genau dieses Gerät kam — und
auf der Lieferung standen zehn Kunden.

> „Dass ich das wirklich explizit zuweisen kann."

Die Verbindung Warenausgang → Vorgang existiert. Was fehlt, ist die Belegnummer des
Lieferanten an der Bestellung, die dann über den Warenausgang am Vorgang sichtbar bleibt.
Kleine Änderung, hoher Alltagsnutzen.

**Aufwand: 1 Tag.**

### 3.8 Sicherheitsbestand mit Freigabe

> „Dass du den Sicherheitsbestand gar nicht verbuchen kannst, außer mit Freigabe vom Chef."

Zwei Reservemodule liegen für den Schadensfall da und werden sonst „halt schnell"
verbaut. Ein Bestand unter dem Mindestbestand, der eine Freigabe braucht.

**Aufwand: 1–2 Tage.**

---

## 4. Planer

### 4.1 Leitlinien und ausgerichtete Rechtecke — zugesagt

Daniel hat im Termin zugesagt („das wird schnell umgesetzt sein"), also ist das eine
Bringschuld. Manuels Begründung ist technisch sauber:

> „Das Problem ist bei Satellitenbildern, dass Dächer Neigungen haben, und das sind nie
> genau Rechtecke. Aber ich muss halt die Planung so genau wie möglich machen."

Ein Satteldach aus der Luft ist perspektivisch verzerrt — die Dachfläche ist in Wirklichkeit
ein Rechteck, im Bild aber ein Trapez. Wer die Ecken nachklickt, zeichnet die Verzerrung
mit und bekommt eine Fläche, die nicht stimmt. Sein Weg aus der früheren Firma: First
markieren, dann links und rechts ein Rechteck herunterziehen.

Gebraucht wird also: eine Hilfslinie selbst einzeichnen, und ein Rechteck, das sich mit
einer Kante daran ausrichtet und fängt. Bei einem 120 m langen Dach ist das der Unterschied
zwischen einer Planung und einer Schätzung.

**Aufwand: 2–3 Tage.**

### 4.2 Automatische Stringbelegung bei Ost-West

Bekannt und laut Daniel schon in der Pipeline. Bei Ost-West-Belegung ist die automatische
Auslegung unbrauchbar, man muss von Hand zeichnen. Bei allen anderen Dächern funktioniert
sie laut Manuel gut.

### 4.3 Planung löschen

Aus der Mitschrift, und im Transkript hörbar: Daniel hat eine Fläche aus Versehen angelegt
und sie nicht mehr weggekriegt („Hab ich noch nie gemacht"). Eine Planung oder eine
einzelne Fläche muss löschbar sein. Nach CLAUDE.md über `useUndoableMutation` mit
Undo-Toast.

**Aufwand: halber Tag.**

### 4.4 Adresse der Planung korrigierbar

Im Termin stand im Planer die falsche Adresse und ließ sich nicht ändern; Daniel musste
den Vorgang neu suchen. Wenn die Adresse im Vorgang korrigiert wird, muss die Planung
mitziehen — und laut Projektregel müssen die abhängigen Daten nachgeführt werden, sonst
bleibt der alte Stand stehen und sieht wie ein Rechenfehler aus.

**Aufwand: 1 Tag.**

---

## 5. Zeit und Personal

### 5.1 Pause automatisch nachfragen

Der einzige Punkt in diesem Abschnitt mit Termin, weil er am 2. Jänner zwölf Leute
betrifft:

> „Oft vergessen sie es einfach. Wenn du es vergisst, sollen wir automatisch die Pause
> einbuchen." · „Damit der Mitarbeiter einfach gefragt wird, wie lange Pause: 30 Minuten,
> 60 Minuten."

Nach 360 Minuten ab Arbeitsbeginn fragt die Monteur-App nach der Pause, mit 30/45/60 zur
Auswahl, und bucht sie zum Zeitpunkt ein.

Zwei Dinge dabei nicht verwechseln: Das ist eine **Erinnerung**, keine stille Korrektur.
Eine Pause, die das System selbst in eine fremde Zeiterfassung schreibt, ist eine
Arbeitszeitänderung ohne Zutun des Mitarbeiters, und die hat in Österreich
Mitbestimmungscharakter. Die Antwort muss vom Monteur kommen.

Die Regel gehört nach `lib/rules/worktime.ts` und nirgendwo anders hin — sie wird an drei
Stellen gebraucht und darf nur einmal existieren.

**Aufwand: 2 Tage.**

### 5.2 Arbeitszeitregeln von DMMA eintragen

Aus dem Termin, direkt einstellbar, kein Bau:

| Regel | Wert |
|---|---|
| Höchstarbeitszeit Tag | 12 Stunden |
| Höchstarbeitszeit Woche | 50 Stunden (Manuel: „lass mal mit 50 drinnen") |
| Pause fällig nach | 360 Minuten ab Arbeitsbeginn |
| Mindestbesetzung Monteure je Woche | noch zu klären, 2 oder 3 |
| Zweiter Standort | ab 2027, heute nur Aspang Markt |

### 5.3 Urlaub

Resturlaub je Mitarbeiter zum Stichtag, und die Regel: pauschal am 1. Jänner oder monatlich
aufbauend. Bis jetzt monatlich. Manuel fragt die Lohnverrechnerin, weil DMMA zum
Jahresanfang die Buchhaltung wechselt. Dazu die Verfallsfrist — im Gespräch kam das Thema
auf, dass Urlaubstage über Jahre auflaufen.

**Blockiert durch DMMA.** Bis die Antwort da ist, nichts bauen: Eine falsch implementierte
Urlaubsberechnung fällt erst beim ersten Urlaubsantrag auf und muss dann rückwirkend für
alle korrigiert werden.

---

## 6. Fehler und Kleinigkeiten

### 6.1 Portal-Upload wirft einen Fehler — zuerst prüfen

Manuel, als er im Kundenportal auf eine Rückfrage mit Foto antwortet:

> „Aber es wird gesendet. Application error super."

Das ist der einzige harte Fehler, der im Termin sichtbar war, und der Kunde hat ihn gesehen.
Die Datei kam offenbar an, aber die Antwort war ein Fehlerbildschirm. Nach Projektregel darf
kein stiller Fehler stehenbleiben, und hier ist er noch nicht einmal still — er steht beim
Kunden auf dem Schirm.

**Gehört vor allem anderen geprüft.**

### 6.2 „Ganztägig" bei der Terminierung

Steht so in der Mitschrift: „Ganztägig passt nicht." Im Termin hat Daniel den Block von
7 bis 17 Uhr gezogen, nachdem „ganztägig" nichts Brauchbares ergab. Ein Montagetag hat
Anfang und Ende, und die Zeiten brauchen Dispo und Arbeitszeitprüfung.

**Aufwand: halber Tag.**

### 6.3 Angebote ohne Vorgang freischalten

Laut Daniel im Termin bereits gebaut, nur nicht freigeschaltet („das gibt's nämlich schon,
das braucht man nur freischalten"). Vor dem nächsten Call prüfen, ob das stimmt — wenn ja,
ist es ein Feature-Flag; wenn nein, hängt es an 1.1.

### 6.4 Bild pro Angebot

Drohnenfoto im Kunden-PDF. Im Termin war es zu sehen, Manuel fand es gut. Zu prüfen, ob es
je Angebot frei wählbar ist oder nur aus der Planung kommt.

### 6.5 Checklistenpunkte mit Ja/Nein

Aus der Mitschrift: „Checkliste ja nein". Checklisten sind pflegbar und Pflichtfelder
funktionieren. Was fehlt, ist offenbar ein Punkt, der schlicht mit ja oder nein beantwortet
wird, statt Foto oder Text zu verlangen.

**Aufwand: 1 Tag.**

---

## 7. Postfach

Entscheidung ist gefallen: **Microsoft 365 über Graph.** Manuel: „Am besten über Outlook."

Das ist die richtige Wahl und deckt sich mit CLAUDE.md — bei M365 gilt Graph oder gar
nichts, IMAP und SMTP mit Basic Auth sind dort abgeschaltet. Vorteil, den Daniel im Termin
richtig genannt hat: Jede Mail aus dem System liegt auch im „Gesendet"-Ordner des Betriebs.

Hinweis für den nächsten Call: Bei Mahnungen und Erinnerungen wird dieser Ordner laut
Daniels Erfahrung schnell voll. Ein Outlook-Filter in einen eigenen Ordner löst das, und es
ist besser, DMMA weiß das vorher.

---

## 8. Was Manuel gefragt hat und was die Antwort war

Für den nächsten Call, damit nichts zweimal verhandelt wird:

| Frage | Antwort im Termin |
|---|---|
| Teilinventur nur für Kleinteile? | Nein, Inventur ist komplett — aber Artikel lassen sich als „nicht zählen" markieren |
| Artikel einem Lieferanten fest zuweisen? | geht heute nicht → 3.4 |
| Artikelgruppen? | „Artikel ist immer einzeln" → sollte revidiert werden, siehe 3.3 |
| Kunde privat und als Firma? | zweimal anlegen, über die Adresse unterscheiden |
| Prozentsatz der Anzahlung änderbar? | ja, auch 100 % |
| Jedes Modul einzeln klicken beim String? | nein, ziehen geht auch |
| Strompreis hinterlegen? | ja, in den Einstellungen |
| Mindestbestand mit Benachrichtigung? | ja, vorhanden |

---

## 9. Vorschlag für die Reihenfolge

**Noch im November:** Portal-Fehler (6.1) prüfen und beheben. Danach die Daten von DMMA
einfordern (Abschnitt 2) — alles andere wartet darauf.

**Dezember, erste Hälfte:** Rechnungen vollständig (Abschnitt 1). Das ist der Termin, der
nicht verschiebbar ist.

**Dezember, zweite Hälfte:** Pausenabfrage (5.1), weil sie am 2. Jänner zwölf Leute
betrifft und nicht nachträglich eingeführt werden kann, ohne dass die ersten Wochen
Zeitdaten unbrauchbar sind. Dazu die zugesagten Leitlinien im Planer (4.1) und die
Kleinigkeiten aus Abschnitt 6.

**Jänner:** Prüfbefund (3.1) und Einkaufspreise aus der Bestellung (3.2). Beide brauchen
Material von DMMA, und beide sind das, was den Betrieb wirklich bindet.

**Danach:** Lager in der Breite — Wiederbeschaffungszeit, Artikelgruppen, Inventur,
Sicherheitsbestand (3.3, 3.6, 3.8).

Was in diesem Plan bewusst **nicht** vorkommt: die WhatsApp-Anbindung. Daniel hat sie im
Termin für Mitte Dezember erwähnt und gleich selbst relativiert („ich würde einfach warten,
bis alle Fehler beseitigt sind"). Das ist die richtige Einschätzung. Solange die Rechnungen
zum 1. Jänner nicht stehen, ist jede Stunde an WhatsApp eine Stunde am falschen Ende.
