/*
 * Nachtrag zu 0044.
 *
 * Der Versandstempel entscheidet ab jetzt, ob der Kunde sein Angebot im
 * Portal sieht. Ohne diesen Nachtrag wäre bei jedem bestehenden Vorgang
 * schlagartig nichts mehr da — auch bei denen, deren Angebot längst beim
 * Kunden liegt.
 *
 * Als versendet gilt, was die Vertriebsphase erreicht hat: ab „angebot"
 * ist es raus, und alles danach sowieso. Ein Vorgang, der noch in der
 * Anfrage oder Aufnahme steckt, bleibt Entwurf — genau richtig.
 *
 * Der Zeitpunkt ist der Phasenwechsel und nicht now(): sonst stünde bei
 * einem halbjährigen Vorgang „versendet heute".
 */

update vorgang
   set angebot_versendet_am = coalesce(phase_seit, created_at)
 where angebot_versendet_am is null
   and phase in ('angebot', 'beauftragt', 'montage', 'abschluss', 'verloren');
