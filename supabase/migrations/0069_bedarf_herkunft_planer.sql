/*
 * „planer" als Herkunft einer Bedarfsposition (Briefing 8.2).
 *
 * Die Spalte kannte bisher 'angebot', 'paket' und 'manuell'. Positionen
 * aus einer Planung sind aber weder das eine noch das andere: sie
 * stammen aus dem Dach, nicht aus einem Angebot, und sie sind nicht von
 * Hand entstanden.
 *
 * Die Unterscheidung ist keine Kosmetik. Im Material entscheidet sie,
 * was ein erneuter Abgleich anfassen darf — handgepflegte Positionen
 * bleiben unberührt, und ohne eigene Herkunft liesse sich das nicht
 * auseinanderhalten.
 */

alter table vorgang_bedarf drop constraint if exists vorgang_bedarf_herkunft_check;
alter table vorgang_bedarf add constraint vorgang_bedarf_herkunft_check
  check (herkunft in ('angebot', 'paket', 'manuell', 'planer'));
