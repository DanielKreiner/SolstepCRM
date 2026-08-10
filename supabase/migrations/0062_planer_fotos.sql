/*
 * Drohnenfotos als Bildquelle statt der Karte (Briefing 2.3).
 *
 * Privater Bucket, keine öffentlichen Adressen: ein Drohnenfoto zeigt
 * das Haus eines namentlich bekannten Kunden. Eine öffentliche URL wäre
 * dauerhaft und ohne Anmeldung abrufbar — bei Produktbildern (Migration
 * 0024) ist das gewollt, hier wäre es eine Weitergabe von Kundendaten an
 * jeden, der die Adresse errät. Der Planer holt sich stattdessen beim
 * Öffnen eine befristet signierte Adresse.
 *
 * Pfadschema wie überall: {company_id}/{projekt_id}/{datei}
 */

insert into storage.buckets (id, name, public)
values ('planer-fotos', 'planer-fotos', false)
on conflict (id) do nothing;

drop policy if exists "planer fotos read" on storage.objects;
create policy "planer fotos read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'planer-fotos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('planer', 'read')
  );

drop policy if exists "planer fotos write" on storage.objects;
create policy "planer fotos write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'planer-fotos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('planer', 'write')
    and public.tenant_writable()
  );

drop policy if exists "planer fotos update" on storage.objects;
create policy "planer fotos update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'planer-fotos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('planer', 'write')
  );

drop policy if exists "planer fotos delete" on storage.objects;
create policy "planer fotos delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'planer-fotos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('planer', 'write')
    and public.tenant_writable()
  );

/*
 * Die Kalibrierung braucht neben dem Faktor auch die Bildgrösse: ohne
 * sie liesse sich beim Laden nicht sagen, wie viele Meter das Foto
 * überhaupt abdeckt, und der erste Bildaufbau stünde falsch, bis das
 * Bild dekodiert ist.
 */
alter table planer_projekt
  add column if not exists foto_breite int,
  add column if not exists foto_hoehe int;

comment on column planer_projekt.foto_meter_pro_pixel is
  'Kalibrierfaktor: Meter je Bildpunkt des hochgeladenen Fotos. '
  'Null = hochgeladen, aber noch nicht kalibriert — dann sind alle '
  'Längen im Bild Schätzwerte.';
