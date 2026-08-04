-- =====================================================================
-- 0042 — Versand auch ohne eingehängtes Postfach
--
-- mail_outbox.mail_account_id war Pflicht. Solange kein Mandant sein
-- Postfach eingehängt hat, liess sich damit nicht einmal eine Mail in
-- die Warteschlange legen: die Mahnung brach mit "Es ist kein Postfach
-- eingerichtet" ab, und der Text wurde nie geschrieben.
--
-- Die Spalte wird optional. Der Zusteller entscheidet dann: mit Konto
-- über SMTP oder Graph, ohne Konto über den Übergangsweg in
-- lib/mail/resend.ts.
--
-- Das ändert nichts an der Zielarchitektur aus CLAUDE.md 6.1 — jeder
-- Mandant hängt sein eigenes Postfach ein. Es macht nur den Zustand
-- davor benutzbar, statt ihn in einen Fehler laufen zu lassen.
-- =====================================================================

alter table mail_outbox
  alter column mail_account_id drop not null;

comment on column mail_outbox.mail_account_id is
  'Postfach des Mandanten. NULL heisst: noch keins eingehängt — dann '
  'übernimmt der Übergangsversand. Mit der IMAP-Anbindung wird die '
  'Spalte wieder Pflicht.';
