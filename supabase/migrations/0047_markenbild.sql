/*
 * Logo und Farben des Mandanten.
 *
 * Bis hierher gingen alle Mails in Anthrazit und Bernstein raus — also im
 * Aussehen dieser Software und nicht im Aussehen des Betriebs. Für den
 * Kunden ist die Mail aber Post von seinem Elektriker, nicht von uns.
 *
 * Gespeichert wird in company.pdf_settings, weil CLAUDE.md 6.4 genau das
 * dafür vorsieht (Logo, Farben, Fusszeile, Bankdaten) und das Feld noch
 * unbenutzt war. Eine zweite Ablage für „dieselbe Marke, anderes Medium"
 * wäre eine zweite Stelle, an der jemand das Logo tauschen muss.
 *
 * Schreibrecht besteht bereits: 0023 hat pdf_settings freigegeben.
 *
 * Erwartete Form:
 *   {
 *     "logo_url":  "https://…/branding/<company>/logo.png",
 *     "akzent":    "#E8952B",
 *     "fusszeile": "Hofstätter Energietechnik GmbH · Linz · +43 …"
 *   }
 * Alles optional. Fehlt etwas, greift die Voreinstellung im Code.
 */

comment on column company.pdf_settings is
  'Markenbild des Mandanten: logo_url, akzent, fusszeile. Gilt für '
  'PDF und Mail gleichermassen — eine Marke, eine Ablage.';

/*
 * Öffentlicher Bucket, und das ist hier keine Nachlässigkeit, sondern
 * Voraussetzung: Mailprogramme laden Bilder ohne Anmeldung und ohne
 * Signatur. Ein privater Bucket ergäbe in jeder Mail ein leeres Kästchen.
 *
 * Im Bucket liegt ausschliesslich das Firmenlogo — kein Kundenfoto, kein
 * Beleg, nichts Personenbezogenes.
 */
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

/* Pfadschema wie überall: {company_id}/logo/{uuid}-{filename} */
drop policy if exists "branding write" on storage.objects;
create policy "branding write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('einstellungen', 'write')
  );

drop policy if exists "branding update" on storage.objects;
create policy "branding update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('einstellungen', 'write')
  );

drop policy if exists "branding delete" on storage.objects;
create policy "branding delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('einstellungen', 'write')
  );
