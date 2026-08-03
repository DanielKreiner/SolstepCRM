-- =====================================================================
-- 0017 — Der Portallink bleibt im Backoffice sichtbar
--
-- Bisher wurde nur der Hash des Zugangstokens gespeichert. Der Link liess
-- sich damit genau einmal anzeigen — beim Erzeugen. Wer ihn später noch
-- einmal brauchte (Kunde ruft an, Mail ging verloren), musste einen neuen
-- erzeugen und den alten entwerten.
--
-- Das ist für den Alltag unbrauchbar: der Link gehört zum Kunden wie seine
-- Telefonnummer.
--
-- Jetzt liegt der Token zusätzlich VERSCHLÜSSELT daneben, nach demselben
-- Muster wie die Postfachzugangsdaten (mail_account.secret_enc):
-- AES-256-GCM, Schlüssel aus MAIL_CRED_KEY, Format iv || tag || ciphertext.
--
-- Was das bedeutet:
--
--   Ein Leck der Datenbank allein gibt keine Kundenzugänge preis — ohne
--   MAIL_CRED_KEY ist der Blob wertlos. Der Schlüssel liegt in der
--   Umgebung, nicht in der Datenbank.
--
--   Die Prüfung eines eingehenden Tokens läuft weiterhin über token_hash.
--   Der verschlüsselte Wert wird nie zum Vergleichen benutzt, nur zum
--   Anzeigen. Damit bleibt der Prüfpfad unverändert.
--
-- Bestehende Zugänge haben kein token_enc und zeigen weiterhin keinen Link;
-- für sie muss einmal ein neuer erzeugt werden. Ein nachträgliches Füllen
-- ist unmöglich — den Klartext gibt es nicht mehr.
-- =====================================================================

alter table portal_access
  add column if not exists token_enc bytea;

comment on column portal_access.token_enc is
  'Zugangstoken, AES-256-GCM verschlüsselt (MAIL_CRED_KEY). Nur zum '
  'Anzeigen im Backoffice. Geprüft wird gegen token_hash.';

-- Lesen und Schreiben der neuen Spalte, wieder je Spalte (siehe 0009/0015).
grant select (token_enc) on portal_access to authenticated;
grant insert (token_enc) on portal_access to authenticated;
