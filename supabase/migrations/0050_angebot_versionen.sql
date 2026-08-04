/*
 * Angebotsversionen.
 *
 * Bisher las das Portal den lebenden Entwurf: wer nach dem Versand eine
 * Position änderte, änderte damit still auch das, was der Kunde gerade
 * vor sich hatte. Zwei Leute sahen zwei verschiedene Angebote unter
 * derselben Nummer.
 *
 * Ab jetzt ist eine Version genau das, was verschickt wurde. Beim Senden
 * entsteht eine eingefrorene Fassung als vorgang_dokument (typ
 * 'angebot'), und das Portal zeigt immer die neueste VERSENDETE. Wer im
 * Backoffice weiterarbeitet, arbeitet am Entwurf — der Kunde sieht die
 * Änderung, sobald sie geschickt wird, und keine Sekunde früher.
 *
 * Die Mechanik dafür gibt es schon: vorgang_position.dokument_id friert
 * Positionen an einem Dokument ein, genauso wie es die Kaskade an der
 * Auftragsbestätigung tut. Es fehlt nur die Zählung.
 */

alter table vorgang_dokument
  add column if not exists version int;

comment on column vorgang_dokument.version is
  'Fortlaufende Fassung eines Angebots je Vorgang. Nur bei typ=''angebot'' '
  'gesetzt; Rechnungen zählen über ihre Nummer.';

/*
 * Zwei gleiche Versionen zum selben Vorgang wären eine Frage ohne
 * Antwort: welche gilt. Lücken sind erlaubt — ein abgebrochener Versand
 * darf eine Nummer verbrauchen.
 */
create unique index if not exists vorgang_dokument_angebot_version
  on vorgang_dokument (vorgang_id, version)
  where typ = 'angebot' and version is not null;

/*
 * Spaltenrecht: dieselbe Falle wie in 0009, 0029, 0041 und 0044. Ohne
 * eigenes Recht scheitert jede Abfrage, die die Spalte mitliest — nicht
 * die Spalte, die ganze Zeile.
 */
grant select (version) on vorgang_dokument to authenticated;

/*
 * Bestehende versendete Angebote bekommen Fassung 1.
 *
 * Ohne den Nachtrag stünde bei einem laufenden Angebot „Fassung —" und
 * die nächste Version bekäme die 1, obwohl der Kunde längst etwas in
 * Händen hält.
 */
insert into vorgang_dokument (company_id, vorgang_id, typ, version, dateiname, kunde_sichtbar, created_at)
select v.company_id, v.id, 'angebot', 1,
       'Angebot ' || v.number || ' Fassung 1', true, v.angebot_versendet_am
  from vorgang v
 where v.angebot_versendet_am is not null
   and not exists (
     select 1 from vorgang_dokument d
      where d.vorgang_id = v.id and d.typ = 'angebot'
   );

/*
 * Die Positionen dieser Fassung sind der heutige Entwurf — etwas
 * anderes ist nicht mehr rekonstruierbar. Kopiert und nicht verschoben:
 * der Entwurf muss weiterleben, sonst steht der Editor leer da.
 */
do $$
declare d record;
begin
  for d in
    select id, vorgang_id, company_id from vorgang_dokument
     where typ = 'angebot' and version = 1
       and not exists (
         select 1 from vorgang_position p where p.dokument_id = vorgang_dokument.id
       )
  loop
    insert into vorgang_position (
      company_id, vorgang_id, dokument_id, gruppe_id, sort, article_id,
      bezeichnung, beschreibung, menge, einheit, ep_netto, ust_satz,
      rabatt_prozent, optional, kunden_auswahl, kalk_ek, kalk_stunden,
      ist_material, bild_url, upgrade_article_id, upgrade_kategorie,
      upgrade_aufpreis, upgrade_text
    )
    select company_id, vorgang_id, d.id, gruppe_id, sort, article_id,
           bezeichnung, beschreibung, menge, einheit, ep_netto, ust_satz,
           rabatt_prozent, optional, kunden_auswahl, kalk_ek, kalk_stunden,
           ist_material, bild_url, upgrade_article_id, upgrade_kategorie,
           upgrade_aufpreis, upgrade_text
      from vorgang_position
     where vorgang_id = d.vorgang_id and dokument_id is null;
  end loop;
end $$;
