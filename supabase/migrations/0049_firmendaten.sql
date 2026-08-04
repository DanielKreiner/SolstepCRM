/*
 * Die Firmendaten, die auf jedes Dokument gehören.
 *
 * company trug bisher Name, Adresse, UID und IBAN. Für einen Beleg fehlt
 * damit die Hälfte dessen, was ein österreichischer oder deutscher
 * Betrieb draufschreiben muss: Firmenbuchnummer und -gericht, Telefon,
 * Mailadresse, Website. Bisher stand das nirgends und musste im Kopf
 * bleiben — oder fehlte auf der Rechnung.
 *
 * Pflichtangaben nach § 14 UGB (AT) bzw. § 35a GmbHG (DE) auf
 * Geschäftsbriefen: Firma, Rechtsform, Sitz, Firmenbuch-/Handelsregister-
 * nummer und das Gericht. Auf einer Rechnung kommt die UID dazu. Deshalb
 * sind das keine Komfortfelder.
 */

alter table company
  add column if not exists firmenbuch_nr text,
  add column if not exists firmenbuch_gericht text,
  add column if not exists rechtsform text,
  add column if not exists email citext,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists bic text;

comment on column company.firmenbuch_nr is
  'Firmenbuchnummer (AT) oder Handelsregisternummer (DE). Pflichtangabe '
  'auf Geschäftsbriefen.';
comment on column company.firmenbuch_gericht is
  'Firmenbuch- bzw. Registergericht. Gehört zur Nummer und ist ohne sie '
  'wertlos.';

/*
 * Spaltenrechte, dieselbe Falle wie immer: 0023 hat update auf company
 * entzogen und die unbedenklichen Spalten einzeln gewährt. Eine neue
 * Spalte ist damit zunächst für niemanden schreibbar — richtige
 * Voreinstellung, aber sie muss eben nachgezogen werden.
 *
 * select bleibt offen (0023 hat nur update entzogen). Abrechnungsfelder
 * wie plan, seats oder status stehen weiterhin NICHT in dieser Liste.
 */
grant update (
  name, uid_nr,
  address, zip, city, country,
  iban, bic,
  firmenbuch_nr, firmenbuch_gericht, rechtsform,
  email, phone, website,
  pdf_settings, accounting_settings,
  time_settings
) on company to authenticated;
