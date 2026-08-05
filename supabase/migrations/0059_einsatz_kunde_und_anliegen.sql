/*
 * Ein Serviceeinsatz braucht einen Kunden, auch ohne Vorgang.
 *
 * Der Einsatz kennt bisher nur `vorgang_id`. Für eine Montage reicht das
 * — dort kommt die Adresse vom Vorgang. Ein Service ist aber oft genau
 * der Fall, für den es keinen laufenden Vorgang gibt: die Anlage steht
 * seit drei Jahren, der Wechselrichter meldet einen Fehler, jemand fährt
 * hin. Bisher liess sich dieser Einsatz nur mit einem Freitexttitel
 * planen — der Monteur bekam auf „Heute" keine Adresse, keinen
 * Ansprechpartner und keine Telefonnummer.
 *
 * Zwei Spalten, beide optional:
 *
 * - `kunde_id` — für wen. Genügt allein: ein Kunde hat eine Adresse.
 * - `service_ticket_id` — welches Anliegen. Damit hängt der Einsatz an
 *   der Meldung, aus der er entstanden ist, und das Ticket weiss, dass
 *   jemand kommt. Ohne diese Verbindung stünde ein Anliegen weiter als
 *   „offen" im Cockpit, obwohl der Termin längst steht.
 *
 * Kein NOT NULL und keine Prüfung, die art='service' erzwingt: ein
 * interner Einsatz beim Kunden (Nachbesichtigung, Kulanz) ist eine
 * Grauzone, die der Betrieb selbst entscheidet. Erzwungen wird nur, was
 * ohne Zwang kaputtginge.
 */

alter table einsatz
  add column if not exists kunde_id uuid references customer(id) on delete set null,
  add column if not exists service_ticket_id uuid
    references service_ticket(id) on delete set null;

comment on column einsatz.kunde_id is
  'Für wen der Einsatz ist, wenn kein Vorgang dahintersteht. Liefert '
  'Adresse und Kontakt an die Monteur-App.';
comment on column einsatz.service_ticket_id is
  'Das Anliegen, aus dem der Einsatz entstanden ist.';

create index if not exists einsatz_kunde on einsatz (kunde_id);
create index if not exists einsatz_ticket on einsatz (service_ticket_id);

/*
 * Die wiederkehrende Falle dieses Schemas (seit 0009): steht auf einer
 * Tabelle ein SPALTENWEISES Recht, deckt es neue Spalten nicht mit ab —
 * und eine Abfrage, die eine nicht freigegebene Spalte anfasst, liefert
 * nicht etwa diese Spalte leer, sondern GAR NICHTS. Deshalb geprüft
 * statt angenommen: hat einsatz spaltenweise Rechte, werden die neuen
 * Spalten nachgezogen.
 */
do $$
declare
  spaltenweise boolean;
begin
  select exists (
    select 1
      from information_schema.column_privileges
     where table_schema = 'public'
       and table_name = 'einsatz'
       and grantee = 'authenticated'
  ) into spaltenweise;

  if spaltenweise then
    execute 'grant select (kunde_id, service_ticket_id) on einsatz to authenticated';
    execute 'grant insert (kunde_id, service_ticket_id) on einsatz to authenticated';
    execute 'grant update (kunde_id, service_ticket_id) on einsatz to authenticated';
  end if;
end $$;
