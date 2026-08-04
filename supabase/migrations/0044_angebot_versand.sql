/*
 * Angebotsversand als eigener, bewusster Schritt.
 *
 * Bisher entstand ein Angebot und war damit sofort im Portal sichtbar.
 * Das ist falsch herum: ein Angebot ist so lange ein Entwurf, bis der
 * Betrieb sagt, dass es fertig ist. Deshalb zwei Zeitstempel — versendet
 * und vom Kunden zum ersten Mal geöffnet.
 *
 * Zeitstempel, kein Kennzeichen: „ist versendet" beantwortet die Frage
 * „seit wann" nicht, und genau die stellt sich beim Nachfassen.
 */

alter table vorgang
  add column if not exists angebot_versendet_am timestamptz,
  add column if not exists angebot_gesehen_am   timestamptz;

comment on column vorgang.angebot_versendet_am is
  'Wann das Angebot bewusst an den Kunden geschickt wurde. Vorher ist es '
  'ein Entwurf und im Portal nicht sichtbar.';
comment on column vorgang.angebot_gesehen_am is
  'Wann der Kunde das Angebot im Portal zum ersten Mal geöffnet hat. '
  'Nur der erste Aufruf, nicht jeder — die Frage ist, ob er es gesehen hat.';

/*
 * Spaltenrechte, dieselbe Falle wie 0009, 0029 und 0041: 0025 hat das
 * Tabellenrecht auf vorgang entzogen. Ohne eigenes Recht scheitert jede
 * Abfrage, die die Spalte mitliest — nicht die Spalte, die ganze Zeile.
 *
 * Kein update-Recht: gesetzt wird beides serverseitig. Der Zeitpunkt des
 * Versands ist eine Tatsache und kein Eingabefeld.
 */
grant select (angebot_versendet_am, angebot_gesehen_am)
  on vorgang to authenticated;

-- ------------------------------------------------------------- POSTAUSGANG

/*
 * Wozu die Mail gehört. Ohne das lässt sich im Backoffice keine
 * verständliche Liste zeigen — „3 Mails" ist keine Auskunft, „Angebot
 * am 4.8. an k.weber@…" schon.
 */
alter table mail_outbox
  add column if not exists art text;

comment on column mail_outbox.art is
  'angebot | rueckfrage | mahnung | bestellung | sonstiges — wofür die '
  'Mail geschrieben wurde. Steuert nur die Anzeige, keine Logik.';

/*
 * Eine erneut gesendete Mail ist eine neue Mail und keine geänderte:
 * der Verlauf muss zeigen, dass zweimal etwas rausging. Der Verweis
 * zeigt auf das Original.
 */
alter table mail_outbox
  add column if not exists erneut_zu uuid references mail_outbox(id) on delete set null;

/*
 * mail_outbox ist für authenticated gesperrt (0001) und bleibt es —
 * dort stehen vollständige Mailtexte. Für die Anzeige am Vorgang reicht
 * deutlich weniger: wer, wann, welcher Zustand. Kein Text, kein Anhang.
 */
create or replace view v_vorgang_mail
with (security_invoker = off) as
select o.id,
       o.company_id,
       o.vorgang_id,
       o.art,
       o.subject,
       o.to_addrs,
       o.status,
       o.attempts,
       o.last_error,
       o.sent_at,
       o.created_at,
       o.erneut_zu
from mail_outbox o
where o.company_id = public.current_company_id()
  and public.can('angebote', 'read');

grant select on v_vorgang_mail to authenticated;

comment on view v_vorgang_mail is
  'Postausgang eines Vorgangs ohne Inhalte. Security definer, weil '
  'mail_outbox für authenticated vollständig gesperrt ist.';
