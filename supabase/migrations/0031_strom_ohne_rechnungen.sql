-- =====================================================================
-- 0031 — Der Aktivitätsstrom verriet die Rechnungsbeträge
--
-- 0025 hat Rechnungsdokumente hinter can('rechnungen','read') gelegt: die
-- Bauleitung sieht den Auftragswert, aber keine Belege. Das greift auch —
-- im Dokumentenblock des Vorgangs stehen für sie nur AB und
-- Materialbedarf.
--
-- Der Verlauf daneben stand offen. Dort las dieselbe Rolle:
--
--   „Schlussrechnung RE-2026-0154 erstellt — 3.513,26 € brutto minus
--    Anzahlung 1.053,98 € = 2.459,28 €. Zahlungsziel 14 Tage."
--
-- Gemessen im E2E-Test, nicht vermutet. Eine Grenze, die nur den einen
-- Weg schliesst, ist keine Grenze — der Strom ist die zentrale Anzeige
-- des Modells und trägt zwangsläufig alles, was passiert.
--
-- Betroffen sind die Typen 'rechnung' und 'zahlung'. Alles andere —
-- Notizen, Phasenwechsel, Gates, Termine — bleibt für jede Rolle
-- sichtbar, die den Vorgang sehen darf. Ohne den Verlauf wüsste die
-- Bauleitung nicht, warum ihr Auftrag steht.
-- =====================================================================

drop policy if exists vorgang_event_sel on vorgang_event;

create policy vorgang_event_sel on vorgang_event
  for select to authenticated
  using (
    company_id = public.current_company_id()
    and (
      typ not in ('rechnung', 'zahlung')
      or public.can('rechnungen', 'read')
    )
  );

comment on table vorgang_event is
  'Eine Tabelle für alles Chronologische. Einträge vom Typ rechnung und '
  'zahlung tragen Beträge und hängen deshalb an can(rechnungen) — '
  'dieselbe Grenze wie die Belege selbst (0025, 0031).';
