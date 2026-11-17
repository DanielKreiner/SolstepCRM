# Onboarding DMMA Elektrotechnik GmbH

Interne Unterlage für den Einrichtungstermin. Nicht an den Kunden geben,
nicht im Screensharing offen lassen.

---

## 1. Die Haltung für diesen Termin

DMMA ist der erste Betrieb auf dieser Software. Das ist kein Makel, den man
verstecken muss — es ist das stärkste Argument, das wir haben, wenn wir es
richtig sagen.

Ein Handwerksbetrieb mit 10 bis 40 Leuten hat mit Standardsoftware eine
immer gleiche Erfahrung: Er zahlt für neunzig Funktionen, braucht zwölf,
und die eine, die er wirklich bräuchte, kommt nie, weil in München ein
Produktmanager anders priorisiert. Dagegen ist „Sie sind der erste, und
deshalb bauen wir das, was bei Ihnen auf der Baustelle passiert" ein
echtes Versprechen.

Was wir **nicht** behaupten: eine Nutzerzahl, Referenzkunden, einen
Support rund um die Uhr, eine Zertifizierung. Das fliegt beim ersten
Supportfall auf, und dann ist der einzige Kunde weg, den wir haben.

Der professionelle Eindruck kommt aus dem Produkt, nicht aus einer
Behauptung. Konkret aus diesen Dingen — alle sind heute vorführbar:

- Artikelstamm mit 476 Positionen, echte technische Datenblätter,
  Herstellerbilder, Wechselrichter von Fronius mit allen Kenndaten
- Planer mit Modul-, Wechselrichter- und Speicherstammdaten, Dachaufnahme
  über Luftbild, Stringverlegung, Verschattung, Ertragsrechnung
- Angebots-PDF mit ihrem Logo, technischer Teil ohne Preise, Preisteil
  getrennt
- Rollenmatrix, die serverseitig greift: Der Monteur sieht keine
  Lohnkosten, auch wenn er die Adresse errät
- Österreichisches Arbeitsrecht in der Einsatzplanung: Ruhezeit,
  Höchstarbeitszeit, Pausenpflicht, je Standort einstellbar
- Monteur-App, die offline weiterläuft und nachsendet

Wenn jemand fragt, wie viele Betriebe das nutzen, ist die Antwort:
„Sie sind der erste produktive Betrieb. Entwickelt ist es mit einem
PV-Betrieb über die letzten Monate, und zwar entlang echter Aufträge —
deshalb sieht es aus wie Handwerk und nicht wie ein Formulargenerator.
Was das für Sie heißt: Sie bekommen den Preis von heute dauerhaft, und
Sie entscheiden mit, was als Nächstes gebaut wird."

---

## 2. Vor dem Termin erledigt

- [ ] Demobestand aus dem Mandanten entfernt (`pnpm mandant:bereinigen --wirklich`)
- [ ] Standort auf Aspang Markt umgestellt, zweiter Standort entfernt
- [ ] Eigener Zugang wieder aktiv gesetzt
- [ ] Firmendaten geprüft: Name, Anschrift, Mailadresse, Telefon
- [ ] Logo im Erscheinungsbild sichtbar, Angebots-PDF einmal erzeugt und angesehen
- [ ] e2e-Sperre aktiv, damit kein Testlauf in den Echtmandanten schreibt
- [ ] Zugang für den Geschäftsführer vorbereitet, aber noch nicht versendet —
      die Einladung geht **im Call** raus, das ist ein Moment, den man zeigt

---

## 3. Ablauf, 90 Minuten

Die Reihenfolge ist Absicht: Nach zwanzig Minuten hält DMMA ein PDF mit
dem eigenen Logo in der Hand. Alles davor ist Aufwand, alles danach ist
Ausbau.

**1. Ankommen (5 min)**
Was heute passiert, was danach offen ist, wie lange es dauert. Kein
Produktvortrag — sie haben schon ja gesagt.

> „Wir richten heute Ihren Betrieb ein. Am Ende des Termins haben Ihre
> Leute Zugänge, Ihr Briefkopf steht auf Angebot und Rechnung, und wir
> haben gemeinsam einen echten Vorgang durchgespielt. Was wir heute nicht
> schaffen, ist Ihr Altbestand — dafür brauche ich Daten von Ihnen, darüber
> reden wir am Schluss."

**2. Firmendaten und Briefkopf (10 min)**
Firmenwortlaut, Anschrift, UID, Firmenbuch, IBAN, Zahlungsziel, Fußzeile.
Logo sitzt schon. Danach **sofort** ein Angebots-PDF erzeugen und zeigen.

Das ist der Moment, der zieht. Nicht erklären, dass es geht — vorführen.

**3. Standort und Arbeitszeitregeln (10 min)**
Aspang Markt, Feiertagsregion Niederösterreich, Normalarbeitszeit,
Ruhezeit, Pausenregel, Mindestbesetzung. Dann die Zuschlagssätze: Abend,
Nacht, Samstag, Sonntag, Feiertag.

> „Diese Zahlen sind kein Anzeigekram. Wenn ein Dienstplan die Ruhezeit
> verletzt, hält das System die Veröffentlichung an, bis jemand das
> bewusst bestätigt. Das ist der Unterschied zwischen einer Software, die
> Zeiten sammelt, und einer, die Ihnen den Rücken freihält."

**4. Mitarbeiter anlegen und einladen (15 min)**
Gemeinsam durchgehen: Name, Mailadresse, Rolle, Wochenstunden,
Beschäftigungsart, Urlaubsanspruch. Interner Stundensatz nur für die, bei
denen er bekannt ist — dazu sagen, wofür er dient (Nachkalkulation, nicht
Lohnverrechnung).

Die Einladungen gehen im Termin raus. Wer gerade am Handy ist, kann die
Mail aufmachen und sein Passwort setzen, während wir reden.

**5. Rollen und wer was sieht (10 min)**
Die Rollenmatrix durchgehen, mit Betonung auf: Wer sieht Rechnungen, wer
sieht Stundenkosten, wer sieht Personalakten.

> „Das wird serverseitig durchgesetzt, nicht im Bildschirm ausgeblendet.
> Ein Monteur, der die Adresse der Rechnungsseite errät, bekommt keine
> Daten, sondern eine Absage aus der Datenbank."

**6. Postfach einhängen (10 min)**
Der Punkt, an dem es am ehesten hängt. Microsoft 365 braucht die
Zustimmung des Administrators, ein anderer Anbieter braucht ein
App-Passwort. Wenn es hier klemmt: nicht festbeißen, Termin dafür
ausmachen, weitermachen.

**7. Ein echter Vorgang (15 min)**
Einen laufenden Kunden anlegen, Dach im Planer aufnehmen, Module setzen,
Strings verlegen, Angebot erzeugen, an die eigene Adresse senden. Sie
bekommen die Mail im Termin.

**8. Monteur-App am Handy (10 min)**
Ein Monteur meldet sich an, stempelt ein, bucht Material. Flugmodus
einschalten und zeigen, dass es weiterläuft.

**9. Nächste Schritte (5 min)**
Was offen ist, wer was bis wann liefert, nächster Termin.

---

## 4. Was wir von DMMA brauchen

Diese Liste vor dem Termin schicken, damit sie es zusammensuchen können.

### Für Angebot und Rechnung
- Firmenwortlaut, wie er im Firmenbuch steht
- Anschrift, Telefon, Mailadresse für den Briefkopf
- UID-Nummer, Firmenbuchnummer und zuständiges Gericht
- IBAN, BIC, Bankname
- Zahlungsziel in Tagen, Skonto falls üblich
- Fußzeile, wie sie bisher auf den Angeboten steht
- **Bei welcher Nummer sollen Angebote und Rechnungen weiterlaufen?**
  Das ist wichtig: Wenn die Buchhaltung bei RE-2026-0312 steht, darf
  die Software nicht bei 1 anfangen.

### Menschen
Je Mitarbeiter: Name, Mailadresse, Rolle (Geschäftsführung, Büro,
Bauleitung, Montage, Lager), Wochenstunden, Beschäftigungsart,
Urlaubsanspruch in Tagen.

Zusätzlich für die Nachkalkulation, freiwillig: interner Stundensatz je
Mitarbeiter. Den sieht nur, wer das Recht dafür hat.

### Arbeitszeit
- Normalarbeitszeit pro Woche
- Rundung der Zeiterfassung, falls üblich (auf 5 oder 15 Minuten)
- Pausenregel: ab wann, wie lange, automatisch abziehen oder nicht
- Zuschlagssätze: Abend, Nacht, Samstag, Sonntag, Feiertag
- Gilt ein Kollektivvertrag, der davon abweicht?

### Postfach
- Über welche Adresse sollen Angebote und Rechnungen rausgehen?
- Microsoft 365 oder anderer Anbieter?
- Bei Microsoft: Wer ist Administrator und kann zustimmen?
- Bei anderen: App-Passwort, nicht das Hauptpasswort

### Daten übernehmen
- Kundenstamm: in welcher Form liegt er vor? Excel, Word, bisherige
  Software, Papier?
- Welche Lieferanten, und gibt es Preislisten als Datei?
- Welche laufenden Baustellen sollen in die Software, und wie weit sind sie?

### Rechtliches
- Auftragsverarbeitungsvertrag unterschreiben
- Hinweis: Zeiterfassung mit Kontrollcharakter kann in Österreich
  zustimmungs- oder betriebsvereinbarungspflichtig sein (§ 96 ArbVG).
  Das ist ihre Pflicht als Arbeitgeber, nicht unsere — wir liefern eine
  Mustervorlage mit.

---

## 5. Formulierungen für die heiklen Momente

**„Wie viele Betriebe nutzen das?"**
> „Sie sind der erste produktive Betrieb. Entwickelt wurde es über Monate
> entlang echter PV-Aufträge. Was Sie davon haben: Sie bekommen den Preis
> von heute dauerhaft, Ihre Anforderungen gehen vor, und Sie reden mit
> dem, der es gebaut hat, und nicht mit einem Ticketsystem."

**„Was, wenn es Sie in zwei Jahren nicht mehr gibt?"**
Diese Frage kommt, und sie ist berechtigt. Nicht wegreden.
> „Sie können jederzeit alles herausholen — Kunden, Aufträge, Rechnungen,
> Dokumente, Fotos, als ZIP mit CSV-Dateien, per Knopfdruck, ohne uns zu
> fragen. Das ist kein Versprechen, das zeige ich Ihnen gleich. Damit sind
> Sie nie in der Lage, in der Sie mit Ihrer jetzigen Lösung vielleicht
> sind."

**„Was kostet es?"**
Grundgebühr plus Preis je Nutzer, zwei Klassen: Vollzugang für Büro und
Bauleitung, günstiger Zugang für Montage. Wenn über den Pilotpreis
geredet wird, Gegenleistung benennen statt nur Rabatt zu geben:
Rückmeldung aus dem Betrieb, Nennung als Referenz, Bereitschaft für
einen Besuch mit dem nächsten Interessenten.

**„Wer sieht unsere Lohndaten?"**
> „Niemand außer denen, denen Sie das Recht geben. Wenn ich zur
> Fehlersuche in Ihren Mandanten muss, trage ich einen Grund ein, es gilt
> maximal 24 Stunden, standardmäßig nur lesend — und Sie sehen jeden
> dieser Zugriffe in Ihrem eigenen Protokoll."

**„Können wir das erst testen?"**
Ja, und das ist kein Zugeständnis, sondern der Plan: ein Standort, ein
Trupp, vier Wochen, danach entscheiden.

**Wenn etwas im Termin nicht funktioniert**
Nicht überspielen. „Das schaue ich mir an und melde mich heute noch" ist
besser als eine Ausrede, und bei einem Pilotkunden ist genau das die
Leistung, die er kauft.

---

## 6. Was heute bewusst offen bleibt

Ehrlich benennen, damit es keine Enttäuschung gibt:

- **Mailversand** läuft bis zum Einhängen des Postfachs über einen
  Zwischenweg. Erst mit ihrem eigenen Postfach kommen Antworten der Kunden
  automatisch in die Software zurück.
- **Altbestand** kommt nicht heute. Kunden und Artikel werden in einem
  zweiten Termin importiert, wenn die Dateien da sind.
- **Buchhaltungsexport** ist eingebaut, aber auf ihre Kontenstruktur noch
  nicht abgestimmt. Dafür brauchen wir den Kontenplan vom Steuerberater.
- **Abrechnung über Stripe** ist noch nicht angeschlossen. Die ersten
  Monate laufen über Rechnung.
