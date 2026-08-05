/*
 * Material und Netzanmeldung halten die Terminierung nicht mehr auf.
 *
 * Beide waren Pflicht-Gates, und beide sind es aus der Praxis heraus
 * nicht: Material, das noch nicht im Regal liegt, wird bestellt — der
 * Termin steht trotzdem, sonst kann niemand disponieren. Und die
 * Netzanmeldung läuft beim Netzbetreiber, oft wochenlang; sie gehört
 * ans Ende des Ablaufs und nicht vor die Montage.
 *
 * Ein Gate, das jede Terminierung blockiert, wird nach zwei Wochen
 * pauschal abgehakt — und ist dann als Warnung wertlos. Beide bleiben
 * sichtbar und melden sich, sie sperren nur nicht mehr.
 */

update gate_template
   set blocking = false
 where key in ('material', 'netzanmeldung');

update vorgang_gate
   set blocking = false
 where key in ('material', 'netzanmeldung');

/* Die Netzanmeldung wandert ans Ende der Reihe. */
update gate_template set sort = 90 where key = 'netzanmeldung';
update vorgang_gate set sort = 90 where key = 'netzanmeldung';
