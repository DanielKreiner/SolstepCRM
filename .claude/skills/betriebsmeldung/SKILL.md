---
name: betriebsmeldung
description: Der Weg von einer Fehlermeldung aus dem Betrieb bis zum gepushten Fix in der Betriebssoftware — reproduzieren, Ursache an der einen Stelle finden, beheben, Regressionstest, Altdaten nachziehen, committen. Nutze diese Skill, sobald Daniel ein Symptom aus der laufenden Anwendung meldet: "da steht überall der Einzelpreis", "der springt mir von 11 auf 12 Uhr", "wie kann es sein, dass dort Module sind", "funktioniert nicht mehr", "ist verkehrt rum" — auch wenn er nicht nach einem Fix fragt, keine Datei nennt und keinen Stacktrace mitschickt. Greift ebenso bei kurzen Beschwerden über Aussehen oder Verhalten eines Screens, PDFs oder des Kundenportals.
---

# Fehlermeldung aus dem Betrieb

Daniel meldet Fehler so, wie sie ihm auffallen: in einem Satz, aus der laufenden
Anwendung heraus, oft mit Screenshot, fast nie mit Dateipfad. Diese Skill
beschreibt den Weg von so einem Satz zum gepushten Fix.

Der Kern ist nicht Geschwindigkeit, sondern **die Ursache statt des Symptoms**.
Ein Symptom lässt sich in fünf Minuten wegpatchen; wenn dieselbe Ursache an drei
Stellen wirkt, kommt sie in zwei Tagen an der nächsten wieder hoch, und dann
kostet sie das Doppelte. Die Beispiele weiter unten stammen alle aus echten
Meldungen — sie zeigen, wie weit das Symptom vom Verursacher entfernt liegen
kann.

## Ablauf

### 1. Das Symptom festnageln, bevor du suchst

Schreib dir auf, was genau behauptet wird und was daraus folgen müsste. „Er
springt von 11 auf 12 Uhr" heisst: Eingabe 11:00, Anzeige 12:00, also eine
Stunde. Eine Stunde ist keine Zeitzone in Österreich im Sommer — das sind zwei.
Solche Unstimmigkeiten sind Gold wert: Sie sagen dir, dass deine erste Hypothese
falsch ist, bevor du eine Stunde in sie investierst.

Wenn Zahlen im Spiel sind, hol dir die echten Werte aus der Datenbank, bevor du
etwas vermutest. Der gespeicherte Wert entscheidet, ob der Fehler beim Schreiben
oder beim Anzeigen sitzt — und das halbiert die Suche sofort.

```bash
set -a; . ./.env.local; set +a
REF=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's#https://([^.]+).*#\1#')
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"select ... limit 5;"}'
```

### 2. Die Ursache suchen, nicht die Stelle

Frag dich bei jedem Fund: *Warum* ist das so, und *wo* wurde die Entscheidung
getroffen? Der Ort, an dem es auffällt, ist selten der Ort, an dem es entsteht.

Drei Muster, die in dieser Anwendung immer wieder auftauchen:

**Zeitzonen.** `new Date("2026-09-01T11:00")` liest die Zone des laufenden
Prozesses. Im Browser ist das zufällig die richtige, auf Vercel ist es UTC.
Alles, was Wanduhrzeit in einen Zeitpunkt verwandelt, gehört über
`fromZonedTime(..., TZ)`; alles, was zurückrechnet, über `formatInTimeZone`.
Symptome: verschobene Stunden, Blöcke im falschen Tag, ganztägige Einträge, die
in der Spalte des Vortags auftauchen.

**Eingefrorene Fassungen.** Angebot, Auftragsbestätigung und Rechnung sind
Kopien mit `dokument_id`. Wird beim Einfrieren etwas vergessen — Gruppen,
Rabatt, ein Kennzeichen —, sucht das spätere Dokument es in derselben Fassung,
findet nichts und stellt ersatzweise etwas anderes dar. Symptom: „auf der
Rechnung steht plötzlich der Einzelpreis".

**Nachführen fehlt.** Ändert sich eine Fläche, ein Raster, eine Grundlage, müssen
die abhängigen Daten nachziehen. Fehlt der Aufruf, bleibt der alte Stand stehen
und sieht aus wie ein Rechenfehler. Symptom: „dort ist eine Sperrfläche, warum
liegen da Module".

Und ein vierter Fall, der nicht wie ein Fehler aussieht: Eine Bedingung, die bei
`0` nie greift. `abstand < h.abstand` ist bei einem Saum von null auch dann
falsch, wenn sich die Kanten schneiden. Wo eine Prüfung eine Grenze vergleicht,
prüfe den Fall, dass die Grenze null ist.

### 3. An einer Stelle beheben

Wenn dieselbe Rechnung an zwei Orten steht, zieh sie heraus, statt beide zu
ändern. Rechenlogik gehört nach `lib/`, ohne Abhängigkeit zu React, Next oder
Supabase — dann lässt sie sich mit vitest prüfen und von Draufsicht, 3D, PDF und
Portal gemeinsam benutzen. Zwei Kopien sind zwei Wahrheiten, und die zweite
merkt niemand.

Prüf bei jedem Fix, ob derselbe Fehler noch woanders sitzt. Der Zeitzonenfehler
im Dialog sass auch in der Tafel, im Verschieben und im Wochenfenster der Seite.
Ein Fix, der nur die gemeldete Stelle trifft, ist ein halber Fix.

### 4. Einen Test schreiben, der den Fehler gefunden hätte

Nicht „einen Test", sondern **diesen** Test: Er muss vor dem Fix rot sein. Der
Zeitzonentest prüft deshalb den gespeicherten UTC-Zeitpunkt und nicht die
Anzeige — die Anzeige stimmt auf dem Entwicklungsrechner immer.

- Reine Rechnung → vitest neben dem Modul (`lib/**/*.spec.ts`)
- Weg durch die Oberfläche → Playwright in `e2e/`, und dort gegen die **Datenbank**
  prüfen, nicht gegen eine Erfolgsmeldung. Meldungen verschwinden, sobald die
  Oberfläche umbaut.

Schreib in den Test hinein, was der Fehler war. Der nächste, der ihn liest, soll
verstehen, warum diese Zeile da steht.

### 5. Altdaten nachziehen

Ein Fix wirkt ab jetzt. Was vorher falsch gespeichert wurde, bleibt falsch — und
genau das sieht Daniel morgen im Demo-Termin. Prüf, wie viele Datensätze
betroffen sind, und zieh sie nach, wenn es sich sauber zuordnen lässt. Sag
dazu, was du geändert hast: Datenkorrekturen gehören berichtet, nicht
stillschweigend gemacht.

### 6. Prüfen, committen, pushen

```bash
npx tsc --noEmit && npx eslint app lib components e2e && npx vitest run
```

Playwright läuft **einer nach dem anderen** — mehrere Läufe gleichzeitig
arbeiten auf derselben Datenbank und löschen sich gegenseitig die Projekte weg.
Das erzeugt Dutzende Fehlschläge, die keine sind, und kostet eine halbe Stunde
Fehlersuche.

Die Commit-Nachricht erzählt den Fehler, nicht die Änderung: erst was falsch
war und was es beim Betrieb angerichtet hat, dann warum es passierte, dann was
jetzt gilt. Deutsch, kein Gendern, ganze Sätze, keine Aufzählungspunkte. Betreff
in der Form `fix(bereich): was jetzt wieder stimmt`.

## Antwortstil

Daniel liest die Antwort zwischen zwei Terminen. Was er wissen will:

1. **Was die Ursache war** — in einem Satz, ohne Vorrede
2. **Was du geändert hast** — mit Dateiverweisen als klickbare Links
3. **Womit du es belegt hast** — Testlauf, Screenshot, Zahl aus dem PDF

Kein „Ich habe mir das angesehen und festgestellt". Kein Rückblick auf die
Suche. Wenn du etwas nicht beheben konntest, steht das oben und nicht am Ende.

Wenn du bei der Arbeit etwas anderes findest, das kaputt ist: behebe es mit,
wenn es zum selben Griff gehört, und schreib einen Satz dazu. Was nicht
dazugehört, sag ihm, statt es stillschweigend mitzuändern.

## Was diese Skill nicht tut

Sie ist für Fehler in laufendem Code. Für neue Funktionen, Umbauten am Design
oder Fragen zur Fachlichkeit gilt `CLAUDE.md` — die technische Bauanleitung
schlägt diese Skill in allem, was das Datenmodell, die Mandantentrennung oder
die Integrationen betrifft.
