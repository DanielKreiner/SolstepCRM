/*
 * Die Fassungsnummer bekommt keine Vorgabe mehr.
 *
 * vorgang_dokument.version stammt aus dem ursprünglichen Schema und
 * stand auf 1. Seit 0050 gibt es dazu einen eindeutigen Index über
 * (vorgang_id, version) für Angebote — und damit eine Falle: jede
 * zweite Angebotszeile, die ohne ausdrückliche Fassung entsteht,
 * bekommt wieder die 1 und läuft in die Eindeutigkeit.
 *
 * Der Versandweg setzt die Fassung selbst; alles andere hat gar keine.
 * Genau das soll null bedeuten — ein Dokument ohne gezählte Fassung.
 */

alter table vorgang_dokument alter column version drop default;
/*
 * Und sie darf fehlen. Eine Rechnung hat keine Fassung — sie mit einer
 * 1 zu versehen wäre eine Aussage über etwas, das es nicht gibt.
 */
alter table vorgang_dokument alter column version drop not null;

comment on column vorgang_dokument.version is
  'Fortlaufende Fassung eines Angebots je Vorgang, gesetzt beim Versand. '
  'Ohne Fassung bleibt sie null — Rechnungen zählen über ihre Nummer.';
