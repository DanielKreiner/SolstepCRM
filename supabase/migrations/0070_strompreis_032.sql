/*
 * Durchschnittlicher Netzstrompreis: 0,32 € statt 0,28 € je kWh.
 *
 * Aus dem Betrieb (13.08.2026): „Durchschnittsenergiekosten sind
 * 0,32 €, nicht 0,28 €." Der Wert ist die Vorbelegung der
 * Wirtschaftlichkeitsrechnung und geht in jede Ersparnis, jede
 * Amortisation und jedes Kundenblatt ein — er darf nicht veraltet
 * herumstehen.
 *
 * Bestehende Mandanten werden nur dort nachgezogen, wo noch der alte
 * Standardwert steht. Wer selbst etwas eingetragen hat, behält es:
 * Ein Betrieb, der 0,29 € kalkuliert, hat sich dabei etwas gedacht.
 */
alter table planer_wirtschaft_vorgabe
  alter column strompreis set default 0.320;

update planer_wirtschaft_vorgabe
   set strompreis = 0.320
 where strompreis = 0.280;
