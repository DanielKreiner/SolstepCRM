-- =====================================================================
-- 0040 — Mahnstufen am Rechnungsbeleg
--
-- Das Briefing schloss Mahnwesen aus, und mit dem Altbestand fiel auch
-- der Mahnlauf weg. Nachgereicht auf Wunsch — diesmal am Vorgang.
--
-- Drei Spalten und keine eigene Tabelle: eine Mahnung ist kein Objekt,
-- sondern ein Zustand der Rechnung. Der Verlauf steht ohnehin im
-- Aktivitätsstrom, dort mit Datum und Wortlaut.
-- =====================================================================

alter table vorgang_dokument
  add column if not exists mahnstufe int not null default 0,
  add column if not exists gemahnt_am timestamptz,
  -- Abschaltbar je Rechnung. Wer telefoniert und eine Ratenzahlung
  -- vereinbart hat, will nicht, dass die Software am nächsten Morgen
  -- die zweite Mahnung schickt.
  add column if not exists mahnung_aktiv boolean not null default true;

comment on column vorgang_dokument.mahnstufe is
  '0 = noch nicht gemahnt. Steigt je Lauf um höchstens eine Stufe, damit '
  'ein ausgefallener Cron-Tag die Zahlungserinnerung nicht überspringt.';

comment on column vorgang_dokument.gemahnt_am is
  'Zeitpunkt der letzten Mahnung. Ohne ihn lässt sich nach einem '
  'Streitfall nicht sagen, wann der Kunde was bekommen hat.';

comment on column vorgang_dokument.mahnung_aktiv is
  'false hält den Mahnlauf für diese Rechnung an — Ratenzahlung, '
  'Reklamation, Kulanz. Die Rechnung bleibt offen und in der Liste.';

create index if not exists vorgang_dokument_mahnung_idx
  on vorgang_dokument (company_id, status, faellig_am)
  where mahnung_aktiv;
