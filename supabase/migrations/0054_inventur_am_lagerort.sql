/*
 * Der Zähltermin gehört an den Lagerort, nicht ans Fahrzeug.
 *
 * Aufgefallen im Abnahmetest: das Lager zählt den Bus, die Korrektur
 * wird gebucht — und der Zähltermin bleibt leer. Die Tabelle fahrzeug
 * ist Ressourcenstammdatum aus der Planung und für die Lagerrolle
 * gesperrt; die stille Nicht-Änderung hätte dazu geführt, dass die
 * Inventur auf ewig als „fällig" dasteht.
 *
 * Fachlich ist der Lagerort ohnehin die richtige Stelle: gezählt wird
 * ein Ort, nicht ein Fahrzeug — und das Hauptlager will auch gezählt
 * werden.
 *
 * Die Spalten an fahrzeug bleiben eine Weile stehen (CLAUDE.md 12.a);
 * gelesen werden sie nicht mehr.
 */

alter table lagerort
  add column if not exists inventur_intervall_tage int not null default 28,
  add column if not exists letzte_inventur date;

/* Was am Fahrzeug gepflegt war, wandert an seinen Lagerort. */
update lagerort o
   set inventur_intervall_tage = f.inventur_intervall_tage,
       letzte_inventur = f.letzte_inventur
  from fahrzeug f
 where o.fahrzeug_id = f.id
   and o.letzte_inventur is null;

comment on column lagerort.letzte_inventur is
  'Zuletzt gezählt. Steht hier und nicht am Fahrzeug, weil die '
  'Lagerrolle fahrzeug nicht schreiben darf — und weil ein Ort gezählt '
  'wird, kein Fahrzeug.';
