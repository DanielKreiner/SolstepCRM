/*
 * Sechs Punkte aus dem Startkatalog raus.
 *
 * Der Katalog aus 0078 war zu lang. Was ein Betrieb nicht beisteuern
 * muss, soll ihn auch nicht fragen — eine Liste mit Punkten, die
 * niemanden betreffen, wird nicht abgearbeitet, sondern weggeklickt.
 *
 * Weg sind:
 *
 *   technische-daten    Die technischen Daten der PV-Komponenten pflegen
 *                       wir, nicht der Betrieb. Danach zu fragen heisst,
 *                       ihm unsere Arbeit umzuhängen.
 *   lagerbestand        Kommt aus der Inventur, nicht aus einem Export.
 *   mitarbeiterliste    Entsteht beim Anlegen der Zugänge ohnehin.
 *   laufende-auftraege  }  Beides sind Daten, die wir uns aus dem
 *   offene-rechnungen   }  bisherigen Programm holen, nicht Angaben,
 *   ausgangsbuch        }  die jemand zusammenstellen soll.
 *
 * Gelöscht und nicht ausgeblendet: Die Punkte sind Stammdaten je
 * Mandant, und ein unsichtbarer Eintrag, den niemand mehr findet, ist
 * schlimmer als keiner. Nachgesehen vor dem Löschen: keiner der Punkte
 * war bei einem Mandanten beantwortet, und es hing keine Datei daran.
 * Die Bedingung unten lässt beantwortete Punkte bewusst stehen — wer
 * diese Migration auf einer Datenbank fährt, in der schon jemand
 * geantwortet hat, soll keine Antwort verlieren.
 */

delete from public.einrichtung_punkt
where schluessel in (
    'technische-daten',
    'lagerbestand',
    'mitarbeiterliste',
    'laufende-auftraege',
    'offene-rechnungen',
    'ausgangsbuch'
  )
  and status = 'offen'
  and wert is null
  and anmerkung is null
  and not exists (
    select 1 from public.einrichtung_datei d where d.punkt_id = einrichtung_punkt.id
  );

/*
 * Und aus dem Katalog für neue Mandanten. Die Funktion wird ganz
 * ersetzt statt ergänzt: Ein insert, aus dem man Zeilen herausoperiert,
 * ist beim dritten Mal nicht mehr lesbar.
 */
create or replace function public.seed_einrichtung_punkte(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into einrichtung_punkt
    (company_id, schluessel, bereich, sortierung, titel, grund, art, optionen, dringend)
  values
    -- Unterlagen aus dem bisherigen Programm
    (p_company, 'kundenstamm', 'Unterlagen', 10,
     'Kundenstamm',
     'Mit Kundennummer, Adresse, Telefon, Mail und UID. Format egal, die Spalten ordnen wir zu.',
     'datei', null, true),
    (p_company, 'lieferanten', 'Unterlagen', 20,
     'Lieferanten',
     'Mit der Adresse, an die die Bestellung geht.',
     'datei', null, true),
    (p_company, 'artikel', 'Unterlagen', 30,
     'Artikel',
     'Kleinmaterial grob zusammengefasst, die PV-Teile einzeln.',
     'datei', null, true),

    -- Rechnungen
    (p_company, 'rechnung-muster', 'Rechnungen', 110,
     'Je Rechnungsart eine bisherige Rechnung',
     'Daraus übernehmen wir die Pflichttexte im Wortlaut. Am wichtigsten eine Bauleistungsrechnung.',
     'datei', null, true),
    (p_company, 'rechnungsarten', 'Rechnungen', 120,
     'Welche Rechnungsarten kommen vor?',
     'Nur was angekreuzt ist, wird eingebaut und geprüft.',
     'mehrwahl',
     array['20 % Umsatzsteuer', 'Bauleistung § 19', 'Reverse Charge EU',
           'Innergemeinschaftliche Lieferung', '10 oder 13 %', 'Ausfuhr Drittland'],
     true),
    (p_company, 'steuerberater-postfach', 'Rechnungen', 130,
     'Postfach der Steuerberatung',
     'Dort landet künftig jede freigegebene Rechnung automatisch als PDF.',
     'text', null, true),
    (p_company, 'barzahlung', 'Rechnungen', 150,
     'Kommt Barzahlung vor?',
     'Bei Barumsätzen ist die Registrierkasse zu klären. Die ersetzt diese Software nicht.',
     'wahl', array['nein', 'selten', 'ja, regelmäßig'], true),
    (p_company, 'anzahlung-beleg', 'Rechnungen', 160,
     'Anzahlung über Auftragsbestätigung oder über eine Rechnung?',
     'Wird bei jedem Angebot gefragt. Gibt es eine Regel, wird sie vorbelegt.',
     'wahl',
     array['meist Auftragsbestätigung', 'meist Rechnung', 'je Kunde verschieden'], false),

    -- Postfach
    (p_company, 'postfach-admin', 'Postfach', 210,
     'Wer verwaltet das Mailkonto?',
     'Name und Mailadresse. Diese Person gibt die Verbindung einmal frei, oft die EDV-Betreuung.',
     'text', null, true),
    (p_company, 'absenderadresse', 'Postfach', 220,
     'Absenderadresse für Angebote und Rechnungen',
     'Ein gemeinsames Postfach ist besser als ein persönliches: dann sieht das ganze Büro den Verlauf.',
     'text', null, true),

    -- Personal
    (p_company, 'resturlaub', 'Personal', 310,
     'Resturlaub je Mitarbeiter zum Stichtag',
     'Aus der Lohnverrechnung. Bitte angeben, ob Tage oder Stunden.',
     'datei', null, true),
    (p_company, 'urlaubsregel', 'Personal', 320,
     'Wird der Urlaub zum Jahresbeginn gutgeschrieben oder monatlich aufgebaut?',
     'Dazu in der Anmerkung: ob und wann Resturlaub verfällt.',
     'wahl', array['zum Jahresbeginn', 'monatlich', 'noch offen'], true),
    (p_company, 'kollektivvertrag', 'Personal', 330,
     'Welcher Kollektivvertrag gilt?',
     'Grundlage für Zuschläge und Ruhezeiten. Ohne ihn rechnen Überstunden falsch.',
     'text', null, true),

    -- Lager
    (p_company, 'lieferzeiten', 'Lager', 410,
     'Welche Artikel haben lange Lieferzeit, und wie lange?',
     'Daraus entsteht die Erinnerung: Montagetermin minus Lieferzeit. Eine Woche vorher ist bei sechs Wochen Lieferzeit zu spät.',
     'lang', null, false),
    (p_company, 'artikelgruppen', 'Lager', 420,
     'Welche Artikelgruppen wären sinnvoll?',
     'Damit viele ähnliche Artikel einzeln bleiben, eine Regel aber nur einmal gesetzt werden muss.',
     'lang', null, false),
    (p_company, 'lieferanten-ab', 'Lager', 430,
     'Zwei oder drei Auftragsbestätigungen von Lieferanten',
     'Grundlage dafür, dass die Einkaufspreise künftig daraus gelesen werden. So wie sie hereinkommen, gescannt genügt.',
     'datei', null, false),

    -- Befunde
    (p_company, 'pruefbefund', 'Befunde', 510,
     'Prüfbefund, wie er heute verwendet wird',
     'Als PDF oder ausfüllbares Formular. Erst damit lässt sich der Aufwand abschätzen.',
     'datei', null, false),
    (p_company, 'befund-vorbelegt', 'Befunde', 520,
     'Was soll im Prüfbefund schon ausgefüllt sein?',
     'Gedacht ist: Kundendaten und Anlagenadresse aus dem Auftrag, die Komponenten aus der Auftragsbestätigung. Vor Ort bleiben die Messwerte.',
     'lang', null, false),

    -- Rückmeldung
    (p_company, 'aufgefallen', 'Rückmeldung', 610,
     'Was ist beim Arbeiten aufgefallen?',
     'Fehler, Umwege, Felder die fehlen oder anders heißen sollten. Auch Kleinigkeiten.',
     'lang', null, false),
    (p_company, 'zum-start-wichtig', 'Rückmeldung', 620,
     'Was muss zum Start unbedingt funktionieren?',
     'Danach richtet sich die Reihenfolge der Arbeit.',
     'lang', null, false)
  on conflict (company_id, schluessel) do nothing;
end $$;
