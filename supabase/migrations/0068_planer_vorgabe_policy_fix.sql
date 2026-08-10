/*
 * Schreibpolicy für die Planer-Vorgaben reparieren.
 *
 * 0066 prüfte `can('settings', 'write')`. Diesen Bereich gibt es nicht
 * — er heisst `einstellungen`. `can()` liefert für einen unbekannten
 * Bereich schlicht false, ohne zu klagen: die Policy war damit für
 * jeden gesperrt, auch für die Geschäftsführung.
 *
 * Aufgefallen ist das erst, als ein Test die Rechenvorgaben wirklich
 * speichern wollte. Die Migration lief fehlerfrei durch, die Tabelle
 * stand da, die Policy sah plausibel aus — nur schreiben konnte
 * niemand. Ein Bereichsname als Zeichenkette ist genau die Art Fehler,
 * die keine Datenbank abfängt.
 */

do $$
declare t text;
begin
  foreach t in array array['planer_wirtschaft_vorgabe', 'planer_foerderung'] loop
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_write on %I for all to authenticated
         using (company_id = public.current_company_id()
                and public.can(''einstellungen'', ''write''))
         with check (company_id = public.current_company_id()
                     and public.can(''einstellungen'', ''write'')
                     and public.tenant_writable())', t, t);
  end loop;
end $$;
