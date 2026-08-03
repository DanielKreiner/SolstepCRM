-- Eigener Speicher für Artikelbilder.
--
-- Beim Übernehmen der 468 Artikel aus dem Handelsgeschäft sind die
-- Bildadressen mitgekommen — und die zeigen auf den Supabase-Storage des
-- Shops. Das ist genau die Verbindung, die Abschnitt 0 ausschliesst:
-- eigenes Projekt, kein Zugriff auf Shop-Daten. Konkret hängt daran:
--
--   - Räumt jemand im Shop ein Produkt weg, verlieren Angebote in diesem
--     Produkt ihr Bild — auch verschickte.
--   - Das Angebots-PDF lädt die Bilder beim Erzeugen nach. Es würde bei
--     jeder Erzeugung den Shop-Storage abrufen.
--   - Ein Mandant dieser Software hinge an der Infrastruktur eines
--     fremden Geschäfts.
--
-- Deshalb ein eigener Bucket. Der Übernahmelauf lädt die Bilder herunter
-- und legt sie hier ab; scripts/import-artikelbilder.ts schreibt danach
-- article.image_url auf die eigene Adresse um.
--
-- Öffentlich wie avatars: ein Produktfoto ist kein Personendatum, und das
-- Angebots-PDF lädt es serverseitig nach — mit signierten URLs bräuchte
-- jede PDF-Erzeugung erst eine Signatur je Bild.

insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do nothing;

-- Schreiben darf nur, wer Lager pflegen darf, und nur im eigenen Mandanten.
-- Pfadschema wie überall: {company_id}/article/{article_id}/{uuid}-{name}
drop policy if exists "article images write" on storage.objects;
create policy "article images write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'article-images'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('lager', 'write')
    and public.tenant_writable()
  );

drop policy if exists "article images update" on storage.objects;
create policy "article images update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'article-images'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('lager', 'write')
  );

drop policy if exists "article images delete" on storage.objects;
create policy "article images delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'article-images'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.can('lager', 'write')
    and public.tenant_writable()
  );

comment on column article.image_url is
  'Vollständige Adresse des Produktbilds im Bucket article-images. '
  'Niemals eine fremde Domain — siehe Migration 0024.';
