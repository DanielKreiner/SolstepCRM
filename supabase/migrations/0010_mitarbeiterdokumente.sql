-- =====================================================================
-- 0010 — Personalakte war für alle offen
--
-- job_document trägt beides: Baustellenunterlagen (job_id gesetzt) und
-- die Personalakte (user_id gesetzt) — Verträge, Lohnzettel, Zertifikate.
-- Bisher galt nur die generische company_id-Policy: jeder Angemeldete
-- konnte den Lohnzettel jedes Kollegen lesen.
--
-- Dieselbe Trennlinie wie in 0008: eigene Unterlagen immer, fremde nur mit
-- Leserecht auf 'mitarbeiter'. Baustellenunterlagen bleiben für alle
-- sichtbar — die braucht die Partie auf dem Dach.
-- =====================================================================

drop policy if exists job_document_sel on job_document;

create policy job_document_sel on job_document for select to authenticated
  using (
    company_id = public.current_company_id()
    and (
      user_id is null                       -- Baustellen- und Kundenunterlagen
      or user_id = auth.uid()               -- eigene Personalakte
      or public.can('mitarbeiter', 'read')  -- Personalverantwortung
    )
  );

comment on table job_document is
  'Unterlagen. user_id gesetzt = Personalakte, dann gilt eigene Akte oder '
  'Leserecht auf mitarbeiter. job_id/customer_id gesetzt = Baustellen- oder '
  'Kundenunterlage, für den Mandanten sichtbar.';

-- Signaturstatus als Menge festhalten, damit nichts Beliebiges hineinläuft.
alter table job_document
  add constraint job_document_signature_status_check
  check (signature_status is null
         or signature_status in ('none', 'pending', 'signed'));

-- Ein signiertes Dokument braucht einen Zeitpunkt, sonst ist die Signatur
-- als Nachweis wertlos.
alter table job_document
  add constraint job_document_signed_at_check
  check (signature_status is distinct from 'signed' or signed_at is not null);

create index if not exists job_document_user_idx
  on job_document (company_id, user_id, created_at desc);
