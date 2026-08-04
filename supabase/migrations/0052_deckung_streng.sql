/*
 * Wie streng das Gate „Material" rechnet.
 *
 * Standard: eine Bestellung mit bestätigtem Liefertermin vor dem
 * Montagebeginn zählt als gedeckt. Sonst stünde das Gate bis zum
 * Wareneingang auf rot, obwohl alles seinen Gang geht — und ein Gate,
 * das immer rot ist, sieht bald niemand mehr an.
 *
 * Wer schon einmal von einem Grosshändler versetzt wurde, stellt es
 * strenger: dann zählt erst, was im Haus ist.
 */
alter table company
  add column if not exists deckung_streng boolean not null default false;

grant select (deckung_streng) on company to authenticated;
grant update (deckung_streng) on company to authenticated;
